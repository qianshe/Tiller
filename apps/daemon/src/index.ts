import { WebSocketServer, type WebSocket } from "ws";
import qrcode from "qrcode-terminal";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDefaultConfigPath,
  listAvailableProviders,
  loadTillerConfigStub,
  readTillerConfig,
  resolveProviderById,
  saveProviderToConfig,
  saveWorkspaceToConfig,
} from "@tiller/agent-registry";
import {
  createAcpRuntime,
  testAcpConnection,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import type { ClientToDaemon, DaemonToClient } from "@tiller/sync-protocol";
import type { AcpAgentProvider, AgentMessage, PermissionRequest, SessionResumeInfo, SessionSummary, WorkspaceSummary } from "@tiller/shared";
import { createSessionArtifactStore } from "./session-artifact-store";
import { createSessionMessageStore } from "./session-message-store";
import { createSessionRuntimeStore } from "./session-runtime-store";
import { createSessionStore } from "./session-store";

// Tiller verification ping by Antigravity 🐾
const HOST = "127.0.0.1";
const PORT = 47631;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOGS_DIR = resolve(REPO_ROOT, "logs");
const DAEMON_LOG_FILE = resolve(LOGS_DIR, "daemon.log");

mkdirSync(LOGS_DIR, { recursive: true });

const configPath = getDefaultConfigPath();
const sessionHistoryPath = resolve(dirname(configPath), "sessions.json");
const sessionMessagesPath = resolve(dirname(configPath), "session-messages");
const sessionArtifactsPath = resolve(dirname(configPath), "session-artifacts");
const sessionRuntimesPath = resolve(dirname(configPath), "session-runtimes.json");
const sessionStore = createSessionStore(sessionHistoryPath);
const sessionMessageStore = createSessionMessageStore(sessionMessagesPath);
const sessionArtifactStore = createSessionArtifactStore(sessionArtifactsPath);
const sessionRuntimeStore = createSessionRuntimeStore(sessionRuntimesPath);
const configStub = loadTillerConfigStub(configPath);
let workspaces = loadAvailableWorkspaces();
let agents = listAvailableProviders(configPath);
const sessions = new Map<string, SessionRecord>();
const permissionIndex = new Map<string, { sessionId: string; request: PermissionRequest }>();

// --- Device pairing state ---
let pairedToken: string | null = null;
let pairedSocket: WebSocket | null = null;
let pairingCode: string | null = null;

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function showPairingCode() {
  if (!pairingCode) {
    pairingCode = generatePairingCode();
  }
  const pairUrl = `ws://${HOST}:${PORT}?pair=${pairingCode}`;
  console.log(`[tiller-daemon] Pairing code: ${pairingCode}`);
  console.log("[tiller-daemon] Scan QR code or enter pairing code to connect:");
  qrcode.generate(pairUrl, { small: true }, (qr: string) => {
    console.log(qr);
  });
}

const server = new WebSocketServer({ host: HOST, port: PORT });

server.on("connection", (socket) => {
  socket.on("close", () => {
    if (pairedSocket === socket) {
      pairedSocket = null;
    }
  });

  if (pairedToken) {
    let authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        emit(socket, { type: "error", message: "Authentication timeout. Send device.auth within 5 seconds." });
        socket.close();
      }
    }, 5000);

    socket.on("message", (raw) => {
      if (authenticated) {
        return;
      }

      try {
        const payload = JSON.parse(String(raw)) as ClientToDaemon;
        if (payload.type === "device.auth" && payload.token === pairedToken) {
          if (pairedSocket && pairedSocket !== socket && pairedSocket.readyState === 1) {
            clearTimeout(authTimeout);
            emit(socket, {
              type: "device.auth.result",
              requestId: payload.requestId,
              ok: false,
              message: "Daemon already paired. Restart to reset.",
            });
            socket.close();
            return;
          }

          authenticated = true;
          pairedSocket = socket;
          clearTimeout(authTimeout);
          socket.removeAllListeners("message");
          socket.on("message", (raw2) => {
            try {
              void handleMessage(socket, JSON.parse(String(raw2)) as ClientToDaemon);
            } catch (error) {
              emit(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
            }
          });
          emit(socket, { type: "device.auth.result", requestId: payload.requestId, ok: true, message: "Authenticated" });
        } else {
          clearTimeout(authTimeout);
          if (payload.type === "device.auth") {
            emit(socket, {
              type: "device.auth.result",
              requestId: payload.requestId,
              ok: false,
              message: "Not authenticated or wrong token. Restart daemon to reset.",
            });
          } else {
            emit(socket, { type: "error", message: "Not authenticated or wrong token. Restart daemon to reset." });
          }
          socket.close();
        }
      } catch {
        clearTimeout(authTimeout);
        socket.close();
      }
    });
    return;
  }

  if (!pairingCode) {
    showPairingCode();
  }

  socket.on("message", (raw) => {
    try {
      const payload = JSON.parse(String(raw)) as ClientToDaemon;
      if (payload.type === "device.pair") {
        handlePairing(socket, payload);
        return;
      }
      emit(socket, { type: "error", message: "Daemon not paired yet. Send device.pair first." });
    } catch (error) {
      emit(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
    }
  });
});

server.on("listening", () => {
  logInfo(`[tiller-daemon] listening on ws://${HOST}:${PORT}`);
  logInfo(`[tiller-daemon] config stub ${configStub.exists ? "found" : "not found"} at ${configStub.configPath}`);
});

server.on("error", (error) => {
  logError(`[tiller-daemon] server error: ${error.message}`);
});

process.on("uncaughtException", (error) => {
  logError(`[tiller-daemon] uncaught exception: ${error.stack ?? error.message}`);
});

process.on("unhandledRejection", (reason) => {
  logError(`[tiller-daemon] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

function handlePairing(socket: WebSocket, payload: { type: "device.pair"; requestId: string; pairingCode: string }) {
  if (!pairingCode || payload.pairingCode.toUpperCase() !== pairingCode) {
    emit(socket, {
      type: "device.pair.result",
      requestId: payload.requestId,
      ok: false,
      message: "Invalid pairing code.",
    });
    return;
  }

  pairedToken = generateSessionToken();
  pairedSocket = socket;
  pairingCode = null;
  logInfo("[tiller-daemon] Device paired ✓");

  socket.removeAllListeners("message");
  socket.on("message", (raw) => {
    try {
      void handleMessage(socket, JSON.parse(String(raw)) as ClientToDaemon);
    } catch (error) {
      emit(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
    }
  });

  emit(socket, {
    type: "device.pair.result",
    requestId: payload.requestId,
    ok: true,
    token: pairedToken,
    message: "Device paired successfully.",
  });
}

async function handleMessage(socket: WebSocket, payload: ClientToDaemon) {
  switch (payload.type) {
    case "workspace.list":
      workspaces = loadAvailableWorkspaces();
      emit(socket, {
        type: "workspace.list.result",
        requestId: payload.requestId,
        workspaces,
      });
      return;
    case "workspace.save": {
      const result = saveWorkspaceToConfig(payload.workspace, configPath);
      workspaces = loadAvailableWorkspaces();
      emit(socket, {
        type: "workspace.save.result",
        requestId: payload.requestId,
        ok: true,
        workspaceId: payload.workspace.id,
        message: `Saved workspace to ${result.configPath}`,
      });
      return;
    }
    case "agent.list":
      agents = listAvailableProviders(configPath);
      emit(socket, {
        type: "agent.list.result",
        requestId: payload.requestId,
        agents,
      });
      return;
    case "session.list":
      emit(socket, {
        type: "session.list.result",
        requestId: payload.requestId,
        sessions: sessionStore.list().map(hydrateSessionSummary),
      });
      return;
    case "session.messages.list":
      emit(socket, {
        type: "session.messages.list.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        messages: sessionMessageStore.list(payload.sessionId),
      });
      return;
    case "session.artifacts.get": {
      const artifacts = sessionArtifactStore.get(payload.sessionId);
      emit(socket, {
        type: "session.artifacts.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        outputs: artifacts.outputs,
        diffs: artifacts.diffs,
      });
      return;
    }
    case "session.resume.check": {
      const summary = sessionStore.list().find((item) => item.id === payload.sessionId);
      if (!summary) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          message: "Session not found",
        });
        return;
      }

      const hydrated = hydrateSessionSummary(summary);
      emit(socket, {
        type: "session.resume.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        resume: hydrated.resume ?? buildResumeInfo(hydrated, resolveProviderById(hydrated.agentId, agents)),
      });
      return;
    }
    case "session.resume.start": {
      const summary = sessionStore.list().find((item) => item.id === payload.sessionId);
      if (!summary) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          message: "Session not found",
        });
        return;
      }

      const hydrated = hydrateSessionSummary(summary);
      const resume = hydrated.resume ?? buildResumeInfo(hydrated, resolveProviderById(hydrated.agentId, agents));
      emit(socket, {
        type: "session.resume.start.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        ok: resume.state === "resume-available",
        resume,
        message:
          resume.state === "resume-available"
            ? "Session is already attached to the current daemon process."
            : resume.reason,
      });
      return;
    }
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
        defaultAgent: payload.provider.defaultAgent,
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

      const sessionId = `session-${Date.now()}`;
      const createdAt = new Date().toISOString();
      const summary: SessionSummary = {
        id: sessionId,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        agentId: agent.id,
        agentName: agent.name,
        status: "starting",
        createdAt,
        updatedAt: createdAt,
        messageCount: 0,
        resume: buildResumeInfo(
          {
            id: sessionId,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            agentId: agent.id,
            agentName: agent.name,
            status: "starting",
            createdAt,
            updatedAt: createdAt,
            messageCount: 0,
          },
          agent,
        ),
      };
      sessionStore.upsert(summary);
      persistRuntimeDescriptor(summary, agent);

      emit(socket, {
        type: "session.created",
        requestId: payload.requestId,
        session: summary,
      });

      try {
        const runtime = await createAcpRuntime({
          sessionId,
          workspace,
          agent,
          onEvent: (event) => handleRuntimeEvent(socket, sessionId, event),
        });

        const record: SessionRecord = {
          summary,
          agent,
          workspace,
          runtime,
        };

        sessions.set(sessionId, record);
        updateSessionSummary(sessionId, (current) => current);
      } catch (error) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId,
          message: error instanceof Error ? error.message : "Failed to create session runtime",
        });
        logError(
          `[tiller-daemon] session.create failed for agent=${agent.id} workspace=${workspace.id}: ${error instanceof Error ? error.message : "Failed to create session runtime"}`,
        );
        updateSessionSummary(sessionId, (current) => ({
          ...current,
          status: "error",
          updatedAt: new Date().toISOString(),
          lastMessagePreview: "Session startup failed",
        }));
        emit(socket, {
          type: "session.status",
          sessionId,
          status: "error",
          message: "Session startup failed",
        });
      }
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

      persistSessionMessage(payload.sessionId, {
        id: `${payload.sessionId}-user-${Date.now()}`,
        role: "user",
        text: payload.text,
        timestamp: new Date().toISOString(),
      });
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

      if (!record.runtime.supportsPermissionResponses) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: permission.sessionId,
          message: "Real ACP permission passthrough is not wired yet. The request is still pending.",
          code: "ACP_PERMISSION_UNSUPPORTED",
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
      updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: event.status,
        updatedAt: new Date().toISOString(),
      }));
      emit(socket, {
        type: "session.status",
        sessionId,
        status: event.status,
        message: event.message,
      });
      return;
    case "message":
      persistSessionMessage(sessionId, event.message);
      updateSessionSummary(sessionId, (current) => ({
        ...current,
        updatedAt: event.message.timestamp,
        messageCount: current.messageCount + 1,
        lastMessagePreview: event.message.text.slice(0, 160),
      }));
      emit(socket, {
        type: "agent.message",
        sessionId,
        message: event.message,
      });
      return;
    case "permission-request":
      updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "waiting_for_permission",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.request.reason,
      }));
      permissionIndex.set(event.request.id, { sessionId, request: event.request });
      emit(socket, {
        type: "permission.request",
        sessionId,
        permissionRequest: event.request,
      });
      return;
    case "command-output":
      sessionArtifactStore.appendOutput(sessionId, event.chunk);
      emit(socket, {
        type: "command.output",
        sessionId,
        commandId: event.chunk.commandId,
        chunk: event.chunk,
      });
      return;
    case "diff-update":
      sessionArtifactStore.replaceDiffs(sessionId, event.files);
      emit(socket, {
        type: "diff.update",
        sessionId,
        files: event.files,
      });
      return;
    case "error":
      persistSessionMessage(sessionId, {
        id: `${sessionId}-system-${Date.now()}`,
        role: "system",
        text: event.message,
        timestamp: new Date().toISOString(),
      });
      updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "error",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.message.slice(0, 160),
      }));
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

function persistSessionMessage(sessionId: string, message: AgentMessage) {
  sessionMessageStore.append(sessionId, message);
}

function updateSessionSummary(sessionId: string, mutate: (summary: SessionSummary) => SessionSummary) {
  const activeSummary = sessions.get(sessionId)?.summary;
  const persistedSummary = sessionStore.list().find((item) => item.id === sessionId);
  const base = activeSummary ?? persistedSummary;
  if (!base) {
    return;
  }

  const next = hydrateSessionSummary(mutate(base));
  const record = sessions.get(sessionId);
  if (record) {
    record.summary = next;
  }
  sessionStore.upsert(next);
  persistRuntimeDescriptor(next, record?.agent ?? resolveProviderById(next.agentId, agents));
}

function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
  const record = sessions.get(summary.id);
  const agent = record?.agent ?? resolveProviderById(summary.agentId, agents);
  return {
    ...summary,
    resume: buildResumeInfo(summary, agent),
  };
}

function buildResumeInfo(summary: SessionSummary, agent: AcpAgentProvider | undefined): SessionResumeInfo {
  const mode = resolveResumeMode(agent);
  const active = sessions.has(summary.id);
  const checkedAt = new Date().toISOString();
  const descriptor = sessionRuntimeStore.get(summary.id);

  if (mode === "none") {
    return {
      mode,
      state: "history-only",
      reason: "This provider does not declare runtime resume support.",
      checkedAt,
      providerId: summary.agentId,
      lastSeenAt: summary.updatedAt,
    };
  }

  if (active && mode === "same-process") {
    return {
      mode,
      state: "resume-available",
      reason: "The session is still attached to the current daemon process.",
      checkedAt,
      providerId: summary.agentId,
      runtimeSessionId: summary.id,
      lastSeenAt: summary.updatedAt,
    };
  }

    return {
      mode,
      state: "resume-unavailable",
      reason:
        mode === "same-process"
          ? "History is restored, but this session cannot be resumed after daemon restart."
          : descriptor
            ? "Reconnect descriptor is preserved, but provider-specific reconnect is not implemented yet."
            : "This provider declares external resume capability, but no reconnect descriptor is available yet.",
      checkedAt,
      providerId: summary.agentId,
      lastSeenAt: summary.updatedAt,
    };
}

function resolveResumeMode(agent: AcpAgentProvider | undefined) {
  if (agent?.capabilities?.resumeMode) {
    return agent.capabilities.resumeMode;
  }

  return agent?.capabilities?.sessionResume ? "same-process" : "none";
}

function persistRuntimeDescriptor(summary: SessionSummary, agent: AcpAgentProvider | undefined) {
  const resumeMode = resolveResumeMode(agent);
  if (resumeMode === "none") {
    return;
  }

  sessionRuntimeStore.upsert({
    sessionId: summary.id,
    providerId: summary.agentId,
    resumeMode,
    runtimeSessionId: summary.id,
    lastSeenAt: summary.updatedAt,
    state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
  });
}

function emit(socket: WebSocket, payload: DaemonToClient) {
  socket.send(JSON.stringify(payload));
}

function loadAvailableWorkspaces() {
  const configuredWorkspaces = readTillerConfig(configPath).workspaces ?? [];
  if (configuredWorkspaces.length) {
    return configuredWorkspaces;
  }

  return [
    {
      id: "current-workspace",
      name: basename(REPO_ROOT),
      path: REPO_ROOT.replace(/\\/g, "/"),
    },
  ];
}

function logInfo(message: string) {
  writeLogLine("INFO", message);
  console.log(message);
}

function logError(message: string) {
  writeLogLine("ERROR", message);
  console.error(message);
}

function writeLogLine(level: "INFO" | "ERROR", message: string) {
  appendFileSync(DAEMON_LOG_FILE, `${new Date().toISOString()} [${level}] ${message}\n`, "utf8");
}

type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  workspace: WorkspaceSummary;
  runtime: {
    prompt: (text: string) => void;
    respondPermission: (requestId: string, decision: "allow" | "deny") => void;
    cancel: () => void;
    supportsPermissionResponses: boolean;
  };
};
