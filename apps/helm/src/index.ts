import { WebSocketServer, type WebSocket } from "ws";
import qrcode from "qrcode-terminal";
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDefaultConfigPath,
  listAvailableHelms as listConfiguredHelms,
  listAvailableProjects as listConfiguredProjects,
  listAvailableProviders,
  loadTillerConfigStub,
  readTillerConfig,
  resolveHelmById,
  resolveProjectById,
  resolveProviderById,
  saveProviderToConfig,
  saveWorkspaceToConfig,
} from "@tiller/agent-registry";
import {
  createAcpRuntime,
  testAcpConnection,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import type {
  AcpAgentProvider,
  AgentMessage,
  HelmSummary,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { createAuthenticatedSocketRegistry } from "./authenticated-socket-registry";
import { createSessionArtifactStore } from "./session-artifact-store";
import { createSessionMessageStore } from "./session-message-store";
import { createSessionRuntimeStore, type StoredSessionRuntimeDescriptor } from "./session-runtime-store";
import { createSessionStore } from "./session-store";
import { resolveSessionCleanupOutcome } from "./session-cleanup";
import { createTrustedDeviceStore } from "./trusted-device-store";

// Tiller verification ping by Antigravity 🐾
const HOST = "127.0.0.1";
const PORT = 47631;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOGS_DIR = resolve(REPO_ROOT, "logs");
const HELM_LOG_FILE = resolve(LOGS_DIR, "helm.log");

mkdirSync(LOGS_DIR, { recursive: true });

const configPath = getDefaultConfigPath();
const sessionHistoryPath = resolve(dirname(configPath), "sessions.json");
const sessionMessagesPath = resolve(dirname(configPath), "session-messages");
const sessionArtifactsPath = resolve(dirname(configPath), "session-artifacts");
const sessionRuntimesPath = resolve(dirname(configPath), "session-runtimes.json");
const trustedDevicesPath = resolve(dirname(configPath), "trusted-devices.json");
const sessionStore = createSessionStore(sessionHistoryPath);
const sessionMessageStore = createSessionMessageStore(sessionMessagesPath);
const sessionArtifactStore = createSessionArtifactStore(sessionArtifactsPath);
const sessionRuntimeStore = createSessionRuntimeStore(sessionRuntimesPath);
const trustedDeviceStore = createTrustedDeviceStore(trustedDevicesPath);
const authenticatedSockets = createAuthenticatedSocketRegistry<WebSocket>();
const socketIds = new WeakMap<WebSocket, string>();
let nextSocketSequence = 0;
const configStub = loadTillerConfigStub(configPath);
let helms = loadAvailableHelms();
let workspaces = loadAvailableWorkspaces();
let agents = listAvailableProviders(configPath);
let projects = loadAvailableProjects();
const sessions = new Map<string, SessionRecord>();
const permissionIndex = new Map<string, { sessionId: string; request: PermissionRequest }>();

// --- Device pairing state ---
let pairingCode: string | null = null;

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function showPairingCode() {
  if (!pairingCode) {
    pairingCode = generatePairingCode();
  }
  const pairUrl = `ws://${HOST}:${PORT}?pair=${pairingCode}`;
  console.log(`[tiller-helm] Pairing code: ${pairingCode}`);
  console.log("[tiller-helm] Scan QR code or enter pairing code to connect:");
  qrcode.generate(pairUrl, { small: true }, (qr: string) => {
    console.log(qr);
  });
}

const server = new WebSocketServer({ host: HOST, port: PORT });

server.on("connection", (socket) => {
  logInfo("[tiller-helm] client connected");

  socket.on("close", () => {
    logInfo("[tiller-helm] client disconnected");
    authenticatedSockets.remove(getSocketId(socket));
  });

  beginAuthenticationFlow(socket);
});

function beginAuthenticationFlow(socket: WebSocket) {
  if (!pairingCode) {
    showPairingCode();
  }

  let authenticated = false;
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      reply(socket, { type: "error", message: "Authentication timeout. Send device.auth or device.pair within 5 seconds." });
      socket.close();
    }
  }, 5000);

  socket.on("message", (raw) => {
    if (authenticated) {
      return;
    }

    try {
      const payload = JSON.parse(String(raw)) as ClientToHelm;
      if (payload.type === "device.auth") {
        const result = trustedDeviceStore.authenticate({ deviceId: payload.deviceId, token: payload.token });
        clearTimeout(authTimeout);
        if (!result.ok) {
          showPairingCode();
          reply(socket, {
            type: "device.auth.result",
            requestId: payload.requestId,
            ok: false,
            requiresPairing: result.requiresPairing,
            message: result.message,
          });
          socket.close();
          return;
        }

        authenticated = true;
        authenticateSocket(socket, payload.deviceId);
        logInfo(`[tiller-helm] Trusted device authenticated device=${payload.deviceId} ✓`);
        reply(socket, {
          type: "device.auth.result",
          requestId: payload.requestId,
          ok: true,
          trustedUntil: result.trustedUntil,
          message: result.message,
        });
        return;
      }

      if (payload.type === "device.pair") {
        handlePairing(socket, payload);
        authenticated = true;
        clearTimeout(authTimeout);
        return;
      }

      clearTimeout(authTimeout);
      reply(socket, { type: "error", message: "Helm not authenticated yet. Send device.auth or device.pair first." });
      socket.close();
    } catch (error) {
      clearTimeout(authTimeout);
      reply(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
      socket.close();
    }
  });
}

function authenticateSocket(socket: WebSocket, deviceId: string) {
  const socketId = getSocketId(socket);
  authenticatedSockets.add({
    socketId,
    socket,
    deviceId,
    authenticatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
  socket.removeAllListeners("message");
  socket.on("message", (raw) => {
    try {
      void handleMessage(socket, JSON.parse(String(raw)) as ClientToHelm);
    } catch (error) {
      reply(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
    }
  });
}
server.on("listening", () => {
  logInfo(`[tiller-helm] listening on ws://${HOST}:${PORT}`);
  logInfo(`[tiller-helm] config stub ${configStub.exists ? "found" : "not found"} at ${configStub.configPath}`);
});

server.on("error", (error) => {
  logError(`[tiller-helm] server error: ${error.message}`);
});

process.on("uncaughtException", (error) => {
  logError(`[tiller-helm] uncaught exception: ${error.stack ?? error.message}`);
});

process.on("unhandledRejection", (reason) => {
  logError(`[tiller-helm] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

function handlePairing(socket: WebSocket, payload: Extract<ClientToHelm, { type: "device.pair" }>) {
  if (!pairingCode || payload.pairingCode.toUpperCase() !== pairingCode) {
    reply(socket, {
      type: "device.pair.result",
      requestId: payload.requestId,
      ok: false,
      message: "Invalid pairing code.",
    });
    return;
  }

  const issued = trustedDeviceStore.issue({
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    clientKind: payload.clientKind,
  });
  pairingCode = null;
  authenticateSocket(socket, payload.deviceId);
  logInfo(`[tiller-helm] Device paired device=${payload.deviceId} (${payload.deviceName}) ✓`);

  reply(socket, {
    type: "device.pair.result",
    requestId: payload.requestId,
    ok: true,
    token: issued.token,
    trustedUntil: issued.record.expiresAt,
    deviceName: issued.record.deviceName,
    message: "Device paired successfully.",
  });
}

async function handleMessage(socket: WebSocket, payload: ClientToHelm) {
  switch (payload.type) {
    case "helm.list":
      helms = loadAvailableHelms();
      emit(socket, {
        type: "helm.list.result",
        requestId: payload.requestId,
        helms,
      });
      return;
    case "device.list":
      emit(socket, {
        type: "device.list.result",
        requestId: payload.requestId,
        devices: trustedDeviceStore.list().map(toTrustedDeviceSummary),
      });
      return;
    case "device.revoke": {
      const revoked = trustedDeviceStore.revoke(payload.deviceId);
      const revokedSockets = authenticatedSockets.listForDevice(payload.deviceId);
      const requesterRevoked = revokedSockets.some((record) => record.socket === socket);
      for (const record of revokedSockets) {
        authenticatedSockets.remove(record.socketId);
        emit(record.socket, {
          type: "device.revoke.result",
          requestId: payload.requestId,
          ok: revoked,
          deviceId: payload.deviceId,
          message: revoked ? "This trusted device was revoked. Pair again to reconnect." : "Trusted device not found.",
        });
        record.socket.close();
      }
      if (!requesterRevoked) {
        emit(socket, {
          type: "device.revoke.result",
          requestId: payload.requestId,
          ok: revoked,
          deviceId: payload.deviceId,
          message: revoked ? "Trusted device revoked." : "Trusted device not found.",
        });
      }
      return;
    }
    case "project.list":
      projects = loadAvailableProjects();
      emit(socket, {
        type: "project.list.result",
        requestId: payload.requestId,
        projects,
      });
      return;
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
      projects = loadAvailableProjects();
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
    case "session.list": {
      const normalizedSessions = sessionStore.list().map(migrateStoredSessionSummary);
      logInfo(`[tiller-helm] session.list count=${normalizedSessions.length}`);
      emit(socket, {
        type: "session.list.result",
        requestId: payload.requestId,
        sessions: normalizedSessions,
      });
      return;
    }
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
      logInfo(`[tiller-helm] session.resume.check session=${payload.sessionId}`);
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
      logInfo(`[tiller-helm] session.resume.start session=${payload.sessionId}`);
      const result = await startSessionResume(payload.sessionId);
      logInfo(`[tiller-helm] session.resume.start.result session=${payload.sessionId} ok=${result.ok} method=${result.resume.restoreMethod ?? "none"} message=${result.message}`);
      emit(socket, {
        type: "session.resume.start.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        ok: result.ok,
        resume: result.resume,
        message: result.message,
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
      projects = loadAvailableProjects();
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
      helms = loadAvailableHelms();
      workspaces = loadAvailableWorkspaces();
      agents = listAvailableProviders(configPath);
      projects = loadAvailableProjects();

      const project = resolveProjectById(payload.projectId, projects);
      const workspace = workspaces.find((item) => item.id === payload.workspaceId);
      const agent = resolveProviderById(payload.agentId, agents);
      const helm = project ? resolveHelmById(project.helmId, helms) : undefined;

      if (!project || !workspace || !agent || !helm) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Project, helm, workspace, or agent not found",
        });
        return;
      }

      if (project.workspaceIds?.length && !project.workspaceIds.includes(workspace.id)) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Workspace does not belong to the selected project",
        });
        return;
      }

      if (project.allowedAgentIds?.length && !project.allowedAgentIds.includes(agent.id)) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "ACP agent is not allowed for the selected project",
        });
        return;
      }

      const sessionId = `session-${Date.now()}`;
      const createdAt = new Date().toISOString();
      logInfo(
        `[tiller-helm] session.create requested session=${sessionId} project=${project.id} helm=${helm.id} workspace=${workspace.id} agent=${agent.id}`,
      );
      const summaryBase: SessionSummary = {
        id: sessionId,
        projectId: project.id,
        projectName: project.name,
        helmId: helm.id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        agentId: agent.id,
        agentName: agent.name,
        model: payload.model,
        reasoningEffort: payload.reasoningEffort,
        status: "starting",
        createdAt,
        updatedAt: createdAt,
        messageCount: 0,
      };
      const summary: SessionSummary = {
        ...summaryBase,
        resume: buildResumeInfo(summaryBase, agent),
      };
      sessionStore.upsert(summary);
      persistRuntimeDescriptor(summary, agent);

      broadcastAuthenticated({
        type: "session.created",
        requestId: payload.requestId,
        session: summary,
      });

      try {
        const runtime = await createAcpRuntime({
          sessionId,
          workspace,
          agent,
          sessionConfig: {
            model: summary.model,
            reasoningEffort: summary.reasoningEffort,
          },
          onEvent: (event) => handleRuntimeEvent(sessionId, event),
        });

        const summaryWithRuntime = hydrateSessionSummary({
          ...summary,
          model: runtime.sessionConfigState?.model ?? summary.model,
          reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
          runtimeSessionId: runtime.runtimeSessionId,
        });
        const capabilitiesJson = JSON.stringify(runtime.sessionCapabilities ?? {});
        logInfo(
          `[tiller-helm] ACP session ready session=${sessionId} runtime=${runtime.runtimeSessionId} capabilities=${capabilitiesJson}`,
        );
        const record: SessionRecord = {
          summary: summaryWithRuntime,
          agent,
          workspace,
          runtime,
        };

        sessions.set(sessionId, record);
        sessionStore.upsert(summaryWithRuntime);
        persistRuntimeDescriptor(summaryWithRuntime, agent, runtime.sessionCapabilities);
        broadcastAuthenticated({
          type: "session.created",
          requestId: payload.requestId,
          session: summaryWithRuntime,
        });
      } catch (error) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId,
          message: error instanceof Error ? error.message : "Failed to create session runtime",
        });
        logError(
          `[tiller-helm] session.create failed for project=${project.id} agent=${agent.id} workspace=${workspace.id}: ${error instanceof Error ? error.message : "Failed to create session runtime"}`,
        );
        updateSessionSummary(sessionId, (current) => ({
          ...current,
          status: "error",
          updatedAt: new Date().toISOString(),
          lastMessagePreview: "Session startup failed",
        }));
        broadcastAuthenticated({
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
    case "session.configure": {
      const current = sessions.get(payload.sessionId)?.summary ?? sessionStore.list().find((item) => item.id === payload.sessionId);
      if (!current) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Session not found",
        });
        return;
      }

      const activeRecord = sessions.get(payload.sessionId);
      const runtimeResult = activeRecord
        ? await activeRecord.runtime.configure({ model: payload.model, reasoningEffort: payload.reasoningEffort })
        : null;
      const nextModel = runtimeResult?.state.model ?? payload.model;
      const nextReasoning = runtimeResult?.state.reasoningEffort ?? payload.reasoningEffort;

      updateSessionSummary(payload.sessionId, (summary) => ({
        ...summary,
        model: nextModel,
        reasoningEffort: nextReasoning,
        updatedAt: new Date().toISOString(),
      }));

      const next = hydrateSessionSummary({
        ...current,
        model: nextModel,
        reasoningEffort: nextReasoning,
        updatedAt: new Date().toISOString(),
      });
      broadcastAuthenticated({
        type: "session.updated",
        requestId: payload.requestId,
        session: next,
      });
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
      broadcastAuthenticated({
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
    case "session.cleanup": {
      const record = sessions.get(payload.sessionId);
      const summary = record?.summary ?? sessionStore.list().find((item) => item.id === payload.sessionId);
      if (!summary) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: "Session not found",
        });
        return;
      }

      const provider = record?.agent ?? resolveProviderById(summary.agentId, agents);
      if (record) {
        sessions.delete(summary.id);
        record.runtime.cancel();
      }

      clearPermissionRequestsForSession(summary.id);
      deleteLocalSessionData(summary.id);

      const remoteResult = resolveSessionCleanupOutcome(summary, provider);
      broadcastAuthenticated({
        type: "session.cleanup.result",
        requestId: payload.requestId,
        result: {
          sessionId: summary.id,
          localDeleted: true,
          remoteDeleted: remoteResult.remoteDeleted,
          remoteDeletionAttempted: remoteResult.remoteDeletionAttempted,
          providerId: remoteResult.providerId,
          message: remoteResult.message,
        },
      });
      return;
    }
    default:
      return;
  }
}

function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent) {
  if (!sessions.has(sessionId) && !sessionStore.list().some((item) => item.id === sessionId)) {
    return;
  }

  switch (event.type) {
    case "status":
      logInfo(`[tiller-helm] session.status session=${sessionId} status=${event.status}${event.message ? ` message=${event.message}` : ""}`);
      updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: event.status,
        updatedAt: new Date().toISOString(),
      }));
      broadcastAuthenticated({
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
      broadcastAuthenticated({
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
      broadcastAuthenticated({
        type: "permission.request",
        sessionId,
        permissionRequest: event.request,
      });
      return;
    case "command-output":
      sessionArtifactStore.appendOutput(sessionId, event.chunk);
      broadcastAuthenticated({
        type: "command.output",
        sessionId,
        commandId: event.chunk.commandId,
        chunk: event.chunk,
      });
      return;
    case "diff-update":
      sessionArtifactStore.replaceDiffs(sessionId, event.files);
      broadcastAuthenticated({
        type: "diff.update",
        sessionId,
        files: event.files,
      });
      return;
    case "config-options": {
      const updated = updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: event.state.model ?? current.model,
        reasoningEffort: event.state.reasoningEffort ?? current.reasoningEffort,
        updatedAt: new Date().toISOString(),
      }));
      broadcastAuthenticated({
        type: "session.config.options",
        sessionId,
        state: event.state,
        options: event.options,
      });
      if (!updated) {
        return;
      }
      broadcastAuthenticated({
        type: "session.updated",
        requestId: `session-config-${Date.now()}`,
        session: hydrateSessionSummary(updated),
      });
      return;
    }
    case "error":
      logError(`[tiller-helm] session.error session=${sessionId} code=${event.code ?? "UNKNOWN"} message=${event.message}`);
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
      broadcastAuthenticated({
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

function clearPermissionRequestsForSession(sessionId: string) {
  for (const [requestId, permission] of permissionIndex.entries()) {
    if (permission.sessionId === sessionId) {
      permissionIndex.delete(requestId);
    }
  }
}

function deleteLocalSessionData(sessionId: string) {
  sessionStore.remove(sessionId);
  sessionMessageStore.remove(sessionId);
  sessionArtifactStore.remove(sessionId);
  sessionRuntimeStore.remove(sessionId);
}

function persistSessionMessage(sessionId: string, message: AgentMessage) {
  sessionMessageStore.append(sessionId, message);
}

function updateSessionSummary(sessionId: string, mutate: (summary: SessionSummary) => SessionSummary) {
  const activeSummary = sessions.get(sessionId)?.summary;
  const persistedSummary = sessionStore.list().find((item) => item.id === sessionId);
  const base = activeSummary ?? persistedSummary;
  if (!base) {
    return undefined;
  }

  const next = hydrateSessionSummary(mutate(base));
  const record = sessions.get(sessionId);
  if (record) {
    record.summary = next;
  }
  sessionStore.upsert(next);
  persistRuntimeDescriptor(next, record?.agent ?? resolveProviderById(next.agentId, agents), record?.runtime.sessionCapabilities);
  return next;
}

function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
  const aligned = alignSessionProjectBinding(summary);
  const record = sessions.get(summary.id);
  const agent = record?.agent ?? resolveProviderById(aligned.agentId, agents);
  return {
    ...aligned,
    resume: buildResumeInfo(aligned, agent),
  };
}

function migrateStoredSessionSummary(summary: SessionSummary) {
  const hydrated = hydrateSessionSummary(summary);
  if (
    hydrated.projectId !== summary.projectId ||
    hydrated.projectName !== summary.projectName ||
    hydrated.helmId !== summary.helmId
  ) {
    sessionStore.upsert(hydrated);
  }
  return hydrated;
}

function alignSessionProjectBinding(summary: SessionSummary): SessionSummary {
  const exactProject = resolveProjectById(summary.projectId, projects);
  if (exactProject) {
    return {
      ...summary,
      projectName: exactProject.name,
      helmId: exactProject.helmId,
    };
  }

  const matchedProject =
    projects.find((project) => project.name === summary.projectName) ??
    projects.find((project) => project.workspaceIds?.includes(summary.workspaceId));
  if (!matchedProject) {
    return summary;
  }

  return {
    ...summary,
    projectId: matchedProject.id,
    projectName: matchedProject.name,
    helmId: matchedProject.helmId,
  };
}

function buildResumeInfo(summary: SessionSummary, agent: AcpAgentProvider | undefined): SessionResumeInfo {
  const activeRecord = sessions.get(summary.id);
  const descriptor = sessionRuntimeStore.get(summary.id);
  const checkedAt = new Date().toISOString();
  const runtimeSessionId = summary.runtimeSessionId ?? activeRecord?.runtime.runtimeSessionId ?? descriptor?.runtimeSessionId;
  const capabilities = resolveSessionRestoreCapabilities(agent, descriptor, activeRecord?.runtime.sessionCapabilities);

  if (activeRecord) {
    return {
      mode: "same-process",
      state: "resume-available",
      reason: "Client can reconnect to the still-running Helm session; ACP restore is not required.",
      checkedAt,
      providerId: summary.agentId,
      runtimeSessionId,
      restoreMethod: "client-reconnect",
      lastSeenAt: summary.updatedAt,
    };
  }

  if (runtimeSessionId && (capabilities.sessionLoad || capabilities.sessionResume)) {
    return {
      mode: "reconnect",
      state: "resume-available",
      reason: capabilities.sessionLoad
        ? "ACP agent advertises session/load; Helm can try agent-side restore and history replay."
        : "ACP agent advertises session.resume; Helm can try context restore without replaying old messages.",
      checkedAt,
      providerId: summary.agentId,
      runtimeSessionId,
      restoreMethod: capabilities.sessionLoad ? "session/load" : "session/resume",
      lastSeenAt: summary.updatedAt,
    };
  }

  return {
    mode: "none",
    state: "history-only",
    reason: "ACP agent restore is unavailable; Tiller can only restore UI history recorded by Helm.",
    checkedAt,
    providerId: summary.agentId,
    runtimeSessionId,
    restoreMethod: "ui-history",
    lastSeenAt: summary.updatedAt,
  };
}

function resolveSessionRestoreCapabilities(
  agent: AcpAgentProvider | undefined,
  descriptor?: StoredSessionRuntimeDescriptor | null,
  runtimeCapabilities?: StoredSessionRuntimeDescriptor["capabilities"],
) {
  return {
    sessionLoad: Boolean(runtimeCapabilities?.sessionLoad ?? descriptor?.capabilities?.sessionLoad ?? agent?.capabilities?.sessionLoad),
    sessionResume: Boolean(runtimeCapabilities?.sessionResume ?? descriptor?.capabilities?.sessionResume ?? agent?.capabilities?.sessionResume),
    sessionList: Boolean(runtimeCapabilities?.sessionList ?? descriptor?.capabilities?.sessionList ?? agent?.capabilities?.sessionList),
  };
}

function resolveResumeMode(agent: AcpAgentProvider | undefined) {
  if (agent?.capabilities?.sessionLoad || agent?.capabilities?.sessionResume) {
    return "reconnect";
  }

  return agent?.capabilities?.resumeMode ?? "none";
}

async function startSessionResume(sessionId: string) {
  const activeRecord = sessions.get(sessionId);
  if (activeRecord) {
    const resume = buildResumeInfo(activeRecord.summary, activeRecord.agent);
    logInfo(`[tiller-helm] client reconnect session=${sessionId} runtime=${resume.runtimeSessionId ?? "unknown"}`);
    return {
      ok: true,
      resume,
      message: "Client reconnected to the still-running Helm session; no ACP restore was needed.",
    };
  }

  const summary = sessionStore.list().find((item) => item.id === sessionId);
  if (!summary) {
    const now = new Date().toISOString();
    return {
      ok: false,
      resume: {
        mode: "none" as const,
        state: "resume-unavailable" as const,
        reason: "Session not found.",
        checkedAt: now,
      },
      message: "Session not found.",
    };
  }

  const agent = resolveProviderById(summary.agentId, agents);
  const workspace = workspaces.find((item) => item.id === summary.workspaceId);
  const resume = buildResumeInfo(summary, agent);
  if (!agent || !workspace || !resume.runtimeSessionId || (resume.restoreMethod !== "session/load" && resume.restoreMethod !== "session/resume")) {
    return {
      ok: false,
      resume,
      message: resume.reason,
    };
  }

  try {
    logInfo(`[tiller-helm] ACP restore begin session=${sessionId} runtime=${resume.runtimeSessionId} method=${resume.restoreMethod}`);
    const runtime = await createAcpRuntime({
      sessionId,
      workspace,
      agent,
      sessionConfig: {
        model: summary.model,
        reasoningEffort: summary.reasoningEffort,
      },
      restore: {
        runtimeSessionId: resume.runtimeSessionId,
        strategy: resume.restoreMethod === "session/load" ? "load" : "resume",
      },
      onEvent: (event) => handleRuntimeEvent(sessionId, event),
    });
    const restoredSummary = hydrateSessionSummary({
      ...summary,
      model: runtime.sessionConfigState?.model ?? summary.model,
      reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
      runtimeSessionId: runtime.runtimeSessionId,
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    sessions.set(sessionId, { summary: restoredSummary, agent, workspace, runtime });
    sessionStore.upsert(restoredSummary);
    persistRuntimeDescriptor(restoredSummary, agent, runtime.sessionCapabilities);
    logInfo(`[tiller-helm] ACP restore success session=${sessionId} runtime=${runtime.runtimeSessionId} method=${resume.restoreMethod}`);
    return {
      ok: true,
      resume: buildResumeInfo(restoredSummary, agent),
      message: `ACP ${resume.restoreMethod} completed for this session.`,
    };
  } catch (error) {
    logError(`[tiller-helm] ACP restore failed session=${sessionId}: ${error instanceof Error ? error.message : "ACP restore failed."}`);
    return {
      ok: false,
      resume: {
        ...resume,
        state: "resume-unavailable" as const,
        reason: error instanceof Error ? error.message : "ACP restore failed.",
        checkedAt: new Date().toISOString(),
      },
      message: error instanceof Error ? error.message : "ACP restore failed.",
    };
  }
}

function persistRuntimeDescriptor(
  summary: SessionSummary,
  agent: AcpAgentProvider | undefined,
  capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
) {
  const resolvedCapabilities = resolveSessionRestoreCapabilities(agent, sessionRuntimeStore.get(summary.id), capabilities);
  if (!summary.runtimeSessionId && !resolvedCapabilities.sessionLoad && !resolvedCapabilities.sessionResume && !resolvedCapabilities.sessionList) {
    return;
  }

  sessionRuntimeStore.upsert({
    sessionId: summary.id,
    projectId: summary.projectId,
    helmId: summary.helmId,
    providerId: summary.agentId,
    runtimeSessionId: summary.runtimeSessionId,
    capabilities: resolvedCapabilities,
    lastSeenAt: summary.updatedAt,
    state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
  });
}

function emit(socket: WebSocket, payload: HelmToClient) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function toTrustedDeviceSummary(record: ReturnType<typeof trustedDeviceStore.list>[number]): TrustedDeviceSummary {
  return {
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    clientKind: record.clientKind,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
  };
}

function reply(socket: WebSocket, payload: HelmToClient) {
  emit(socket, payload);
}

function broadcastAuthenticated(payload: HelmToClient) {
  for (const record of authenticatedSockets.listAll()) {
    emit(record.socket, payload);
  }
}

function getSocketId(socket: WebSocket) {
  const existing = socketIds.get(socket);
  if (existing) {
    return existing;
  }
  nextSocketSequence += 1;
  const next = `socket-${nextSocketSequence}`;
  socketIds.set(socket, next);
  return next;
}

function loadAvailableHelms() {
  const configuredHelms = listConfiguredHelms(configPath);
  if (configuredHelms.length) {
    return configuredHelms;
  }

  return [
    {
      id: "local-helm",
      name: "Local Helm",
      host: HOST,
      port: PORT,
    },
  ] satisfies HelmSummary[];
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

function loadAvailableProjects() {
  const configuredProjects = listConfiguredProjects(configPath);
  if (configuredProjects.length) {
    return configuredProjects;
  }

  const fallbackHelm = loadAvailableHelms()[0];
  const fallbackWorkspaces = loadAvailableWorkspaces();
  const fallbackAgents = listAvailableProviders(configPath);
  return [
    {
      id: "current-project",
      name: basename(REPO_ROOT),
      helmId: fallbackHelm.id,
      workspaceIds: fallbackWorkspaces.map((workspace) => workspace.id),
      allowedAgentIds: fallbackAgents.map((agent) => agent.id),
      defaultWorkspaceId: fallbackWorkspaces[0]?.id,
      defaultAgentId: fallbackAgents[0]?.id,
    },
  ] satisfies ProjectSummary[];
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
  appendFileSync(HELM_LOG_FILE, `${new Date().toISOString()} [${level}] ${message}\n`, "utf8");
}

type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  workspace: WorkspaceSummary;
  runtime: {
    runtimeSessionId: string;
    sessionCapabilities?: StoredSessionRuntimeDescriptor["capabilities"];
    sessionConfigState?: {
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
    prompt: (text: string) => void;
    configure: (next: { model?: string; reasoningEffort?: SessionReasoningEffort }) => Promise<{
      runtimeApplied: boolean;
      state: { model?: string; reasoningEffort?: SessionReasoningEffort };
    }>;
    respondPermission: (requestId: string, decision: "allow" | "deny") => void;
    cancel: () => void;
    supportsPermissionResponses: boolean;
  };
};
