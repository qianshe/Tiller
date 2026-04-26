import { WebSocketServer, type WebSocket } from "ws";
import {
  getMockWorkspaces,
  getDefaultConfigPath,
  listAvailableProviders,
  loadTillerConfigStub,
  resolveProviderById,
  saveProviderToConfig,
} from "@tiller/agent-registry";
import {
  createMockAgentRuntime,
  testAcpConnection,
  type SessionRuntimeEvent,
  // TODO(real-acp): replace createMockAgentRuntime with createAcpRuntime(provider, workspace)
} from "@tiller/acp-runtime";
import type { ClientToDaemon, DaemonToClient } from "@tiller/sync-protocol";
import type { PermissionRequest, SessionSummary, WorkspaceSummary } from "@tiller/shared";

const HOST = "127.0.0.1";
const PORT = 47631;

const configPath = getDefaultConfigPath();
const configStub = loadTillerConfigStub(configPath);
const workspaces = getMockWorkspaces();
let agents = listAvailableProviders(configPath);
const sessions = new Map<string, SessionRecord>();
// TODO(v0.3): persist session summaries outside process memory for reconnect / resume flows.
const permissionIndex = new Map<string, { sessionId: string; request: PermissionRequest }>();

const server = new WebSocketServer({ host: HOST, port: PORT });

server.on("connection", (socket) => {
  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(String(raw)) as ClientToDaemon;
      void handleMessage(socket, payload);
    } catch (error) {
      emit(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Invalid client message",
      });
    }
  });
});

server.on("listening", () => {
  console.log(`[tiller-daemon] listening on ws://${HOST}:${PORT}`);
  console.log(
    `[tiller-daemon] config stub ${configStub.exists ? "found" : "not found"} at ${configStub.configPath}`,
  );
});

async function handleMessage(socket: WebSocket, payload: ClientToDaemon) {
  switch (payload.type) {
    case "workspace.list":
      emit(socket, {
        type: "workspace.list.result",
        requestId: payload.requestId,
        workspaces,
      });
      return;
    case "agent.list":
      agents = listAvailableProviders(configPath);
      emit(socket, {
        type: "agent.list.result",
        requestId: payload.requestId,
        agents,
      });
      return;
    case "agent.save": {
      const provider = {
        id: payload.provider.id,
        name: payload.provider.name,
        kind: payload.provider.kind,
        command: payload.provider.command,
        args: payload.provider.args,
        env: payload.provider.env,
        cwd: payload.provider.cwd,
        initializeTimeoutMs: payload.provider.initializeTimeoutMs,
        transport: "stdio" as const,
        protocol: "acp" as const,
        installHint: payload.provider.installHint,
      };

      const result = saveProviderToConfig(provider, configPath);
      agents = listAvailableProviders(configPath);
      emit(socket, {
        type: "agent.save.result",
        requestId: payload.requestId,
        ok: true,
        providerId: provider.id,
        message: `Saved provider to ${result.configPath}`,
      });
      return;
    }
    case "agent.test": {
      const agent = resolveProviderById(payload.providerId, agents);
      if (!agent) {
        emit(socket, {
          type: "agent.test.result",
          requestId: payload.requestId,
          ok: false,
          providerId: payload.providerId,
          message: "Provider not found",
        });
        return;
      }

      if (agent.id === "mock-agent") {
        emit(socket, {
          type: "agent.test.result",
          requestId: payload.requestId,
          ok: true,
          providerId: payload.providerId,
          message: `Mock test passed for ${agent.name}.`,
        });
        return;
      }

      const workspace = workspaces[0];
      const result = await testAcpConnection(agent, workspace?.path);
      emit(socket, {
        type: "agent.test.result",
        requestId: payload.requestId,
        ok: result.ok,
        providerId: payload.providerId,
        message: result.message,
      });
      return;
    }
    case "session.create": {
      const workspace = workspaces.find((item) => item.id === payload.workspaceId);
      const agent = resolveProviderById(payload.agentId, agents);

      if (!workspace || !agent) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Workspace or agent not found",
        });
        return;
      }

      if (agent.id !== "mock-agent") {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Real ACP session runtime is not implemented yet. Use Test agent first; session flow remains mock-only in v0.1/v0.2 bridge mode.",
        });
        return;
      }

      const sessionId = `session-${Date.now()}`;
      const summary: SessionSummary = {
        id: sessionId,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        agentId: agent.id,
        agentName: agent.name,
        status: "idle",
        createdAt: new Date().toISOString(),
      };

      const record: SessionRecord = {
        summary,
        workspace,
        runtime: createMockAgentRuntime({
          sessionId,
          workspace,
          agent,
          onEvent: (event) => handleRuntimeEvent(socket, sessionId, event),
        }),
      };

      sessions.set(sessionId, record);

      emit(socket, {
        type: "session.created",
        requestId: payload.requestId,
        session: summary,
      });
      emit(socket, {
        type: "session.status",
        sessionId,
        status: "idle",
        message: "Mock session ready",
      });
      return;
    }
    case "session.prompt": {
      const record = sessions.get(payload.sessionId);
      if (!record) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Session not found",
        });
        return;
      }

      record.runtime.prompt(payload.text);
      return;
    }
    case "permission.respond": {
      const permission = permissionIndex.get(payload.permissionRequestId);
      if (!permission) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Permission request not found",
        });
        return;
      }

      const record = sessions.get(permission.sessionId);
      if (!record) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Session not found for permission response",
        });
        return;
      }

      permissionIndex.delete(payload.permissionRequestId);
      emit(socket, {
        type: "permission.resolved",
        sessionId: permission.sessionId,
        permissionRequestId: payload.permissionRequestId,
        decision: payload.decision,
      });
      record.runtime.respondPermission(payload.permissionRequestId, payload.decision);
      return;
    }
    case "session.cancel": {
      const record = sessions.get(payload.sessionId);
      if (!record) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Session not found",
        });
        return;
      }

      record.runtime.cancel();
      return;
    }
    default:
      return;
  }
}

function handleRuntimeEvent(socket: WebSocket, sessionId: string, event: SessionRuntimeEvent) {
  switch (event.type) {
    case "status":
      emit(socket, {
        type: "session.status",
        sessionId,
        status: event.status,
        message: event.message,
      });
      return;
    case "message":
      emit(socket, {
        type: "agent.message",
        sessionId,
        message: event.message,
      });
      return;
    case "permission-request":
      permissionIndex.set(event.request.id, { sessionId, request: event.request });
      emit(socket, {
        type: "permission.request",
        sessionId,
        permissionRequest: event.request,
      });
      return;
    case "command-output":
      emit(socket, {
        type: "command.output",
        sessionId,
        commandId: event.chunk.commandId,
        chunk: event.chunk,
      });
      return;
    case "diff-update":
      emit(socket, {
        type: "diff.update",
        sessionId,
        files: event.files,
      });
      return;
    case "error":
      emit(socket, {
        type: "error",
        sessionId,
        message: event.message,
        code: event.code,
      });
      return;
    default:
      return;
  }
}

function emit(socket: WebSocket, payload: DaemonToClient) {
  socket.send(JSON.stringify(payload));
}

type SessionRecord = {
  summary: SessionSummary;
  workspace: WorkspaceSummary;
  runtime: {
    prompt: (text: string) => void;
    respondPermission: (requestId: string, decision: "allow" | "deny") => void;
    cancel: () => void;
  };
};
