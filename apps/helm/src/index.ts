import { WebSocket, WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
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
  saveHelmToConfig,
  saveProjectToConfig,
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
  AcpModelState,
  AgentMessage,
  FileDiffSummary,
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
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "./session-summary";
import { createTrustedDeviceStore } from "./trusted-device-store";

// Tiller verification ping by Antigravity 🐾
const HOST = "127.0.0.1";
const PORT = 47631;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOGS_DIR = resolve(REPO_ROOT, "logs");
const HELM_LOG_FILE = resolve(LOGS_DIR, "helm.log");
const execFileAsync = promisify(execFile);
const GIT_DIFF_MAX_BUFFER = 5 * 1024 * 1024;

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
const projectSemanticSummaryCache = new Map<string, string>();

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
  let authenticated = false;
  const pairingPromptTimer = setTimeout(() => {
    if (!authenticated && socket.readyState === WebSocket.OPEN) {
      showPairingCode();
    }
  }, 500);

  socket.on("message", (raw) => {
    if (authenticated) {
      return;
    }

    try {
      const payload = JSON.parse(String(raw)) as ClientToHelm;
      if (payload.type === "device.auth") {
        const result = trustedDeviceStore.authenticate({ deviceId: payload.deviceId, token: payload.token });
        if (!result.ok) {
          clearTimeout(pairingPromptTimer);
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
        clearTimeout(pairingPromptTimer);
        authenticateSocket(socket, payload.deviceId);
        logInfo(`[tiller-helm] Beacon authenticated device=${payload.deviceId} ✓`);
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
        clearTimeout(pairingPromptTimer);
        handlePairing(socket, payload);
        authenticated = true;
        return;
      }

      reply(socket, { type: "error", message: "Helm not authenticated yet. Send device.auth or device.pair first." });
    } catch (error) {
      reply(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
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
  logInfo(`[tiller-helm] Beacon paired device=${payload.deviceId} (${payload.deviceName}) ✓`);

  reply(socket, {
    type: "device.pair.result",
    requestId: payload.requestId,
    ok: true,
    token: issued.token,
    trustedUntil: issued.record.expiresAt,
    deviceName: issued.record.deviceName,
    message: "Beacon anchored successfully.",
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
    case "helm.save": {
      const result = saveHelmToConfig(payload.helm, configPath);
      helms = loadAvailableHelms();
      projects = await loadAvailableProjectsWithSemanticSummaries();
      emit(socket, {
        type: "helm.save.result",
        requestId: payload.requestId,
        ok: true,
        helmId: payload.helm.id,
        message: `Saved Helm model config to ${result.configPath}`,
      });
      return;
    }
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
          message: revoked ? "This beacon was revoked. Pair again to reconnect." : "Beacon not found.",
        });
        record.socket.close();
      }
      if (!requesterRevoked) {
        emit(socket, {
          type: "device.revoke.result",
          requestId: payload.requestId,
          ok: revoked,
          deviceId: payload.deviceId,
          message: revoked ? "Beacon revoked." : "Beacon not found.",
        });
      }
      return;
    }
    case "project.list":
      projects = await loadAvailableProjectsWithSemanticSummaries();
      emit(socket, {
        type: "project.list.result",
        requestId: payload.requestId,
        projects,
      });
      return;
    case "project.save": {
      try {
        const result = saveProjectToConfig(payload.project, configPath);
        workspaces = loadAvailableWorkspaces();
        projects = await loadAvailableProjectsWithSemanticSummaries();
        emit(socket, {
          type: "project.save.result",
          requestId: payload.requestId,
          ok: true,
          projectId: payload.project.id,
          message: `Saved project to ${result.configPath}`,
        });
        emit(socket, {
          type: "project.list.result",
          requestId: `project-list-${Date.now()}`,
          projects,
        });
        emit(socket, {
          type: "workspace.list.result",
          requestId: `workspace-list-${Date.now()}`,
          workspaces,
        });
      } catch (error) {
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          message: error instanceof Error ? error.message : "Failed to save project.",
        });
      }
      return;
    }
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
      projects = await loadAvailableProjectsWithSemanticSummaries();
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
      const diffs = await hydrateDiffsFromWorkspaceGit(payload.sessionId, artifacts.diffs);
      emit(socket, {
        type: "session.artifacts.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        outputs: artifacts.outputs,
        diffs,
        toolCalls: artifacts.toolCalls,
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
      projects = await loadAvailableProjectsWithSemanticSummaries();
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
    case "agent.model.options.get": {
      const agent = resolveProviderById(payload.providerId, agents);
      const workspace = workspaces.find((item) => item.id === payload.workspaceId);
      if (!agent || !workspace) {
        emit(socket, {
          type: "agent.model.options.result",
          requestId: payload.requestId,
          ok: false,
          providerId: payload.providerId,
          workspaceId: payload.workspaceId,
          message: !agent ? "Provider not found" : "Workspace not found",
          modelOptions: [],
          configOptions: [],
          state: {},
        });
        return;
      }

      const result = await probeAgentModelOptions(agent, workspace);
      emit(socket, {
        type: "agent.model.options.result",
        requestId: payload.requestId,
        providerId: agent.id,
        workspaceId: workspace.id,
        ...result,
      });
      return;
    }
    case "session.create": {
      helms = loadAvailableHelms();
      workspaces = loadAvailableWorkspaces();
      agents = listAvailableProviders(configPath);
      projects = await loadAvailableProjectsWithSemanticSummaries();

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
          modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
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
      let record = sessions.get(payload.sessionId);
      if (!record) {
        logInfo(`[tiller-helm] session.prompt restore-required session=${payload.sessionId} chars=${payload.text.length}`);
        const restore = await startSessionResume(payload.sessionId);
        logInfo(`[tiller-helm] session.prompt restore-result session=${payload.sessionId} ok=${restore.ok} method=${restore.resume.restoreMethod ?? "none"} message=${restore.message}`);
        emit(socket, {
          type: "session.resume.start.result",
          requestId: `session-prompt-restore-${Date.now()}`,
          sessionId: payload.sessionId,
          ok: restore.ok,
          resume: restore.resume,
          message: restore.message,
        });
        record = sessions.get(payload.sessionId);
      }

      if (!record) {
        logError(`[tiller-helm] session.prompt failed session=${payload.sessionId} reason=Session runtime not available`);
        emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          message: "Session runtime is not available. Try reconnecting this Mission first.",
        });
        return;
      }

      logInfo(`[tiller-helm] session.prompt session=${payload.sessionId} chars=${payload.text.length}`);
      const timestamp = new Date().toISOString();
      persistSessionMessage(payload.sessionId, {
        id: `${payload.sessionId}-user-${Date.now()}`,
        role: "user",
        text: payload.text,
        timestamp,
      });
      const updated = updateSessionSummary(payload.sessionId, (current) => applyUserPromptToSummary(current, payload.text, timestamp));
      if (updated) {
        broadcastAuthenticated({
          type: "session.updated",
          requestId: payload.requestId,
          session: updated,
        });
      }
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
      const nextModelOptions = runtimeResult?.modelState?.options ?? current.modelOptions;

      updateSessionSummary(payload.sessionId, (summary) => ({
        ...summary,
        model: nextModel,
        modelOptions: nextModelOptions,
        reasoningEffort: nextReasoning,
        updatedAt: new Date().toISOString(),
      }));

      const next = hydrateSessionSummary({
        ...current,
        model: nextModel,
        modelOptions: nextModelOptions,
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

async function probeAgentModelOptions(agent: AcpAgentProvider, workspace: WorkspaceSummary) {
  const probeSessionId = `probe-${agent.id}-${Date.now()}`;
  let modelState: AcpModelState | undefined;
  let configState: Extract<SessionRuntimeEvent, { type: "config-options" }>["state"] = {};
  let configOptions: Extract<SessionRuntimeEvent, { type: "config-options" }>["options"] = [];

  logInfo(`[tiller-helm] agent.model.options.probe.start provider=${agent.id} workspace=${workspace.id}`);

  try {
    const runtime = await createAcpRuntime({
      sessionId: probeSessionId,
      workspace,
      agent: {
        ...agent,
        initializeTimeoutMs: Math.max(agent.initializeTimeoutMs ?? 0, 180_000),
      },
      onEvent: (event) => {
        if (event.type === "model-options") {
          modelState = event.state;
        } else if (event.type === "config-options") {
          configState = event.state;
          configOptions = event.options;
        } else if (event.type === "error") {
          logError(`[tiller-helm] agent.model.options.probe.error provider=${agent.id} code=${event.code ?? "UNKNOWN"} message=${event.message}`);
        }
      },
    });

    runtime.cancel();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to probe agent model options.";
    logError(`[tiller-helm] agent.model.options.probe.failed provider=${agent.id} workspace=${workspace.id} message=${message}`);
    return {
      ok: false,
      message,
      currentModelId: undefined,
      modelOptions: [],
      configOptions: [],
      state: {},
    };
  }

  const modelCount = modelState?.options.length ?? 0;
  logInfo(
    `[tiller-helm] agent.model.options.probe.result provider=${agent.id} workspace=${workspace.id} currentModel=${modelState?.currentModelId ?? configState.model ?? "<none>"} modelOptions=${modelCount} configOptions=${configOptions.length}`,
  );

  return {
    ok: modelCount > 0 || configOptions.length > 0,
    message: modelCount > 0 || configOptions.length > 0 ? `Loaded ${modelCount || configOptions.length} model option(s).` : "Agent did not return model options.",
    currentModelId: modelState?.currentModelId ?? configState.model,
    modelOptions: modelState?.options ?? [],
    configOptions,
    state: configState,
  };
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
      updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, event.message));
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
    case "tool-call":
      sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
      broadcastAuthenticated({
        type: "tool.call",
        sessionId,
        toolCall: event.toolCall,
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
      if (event.toolCall) {
        sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
        broadcastAuthenticated({
          type: "tool.call",
          sessionId,
          toolCall: event.toolCall,
        });
      }
      return;
    case "diff-update":
      void publishDiffUpdate(sessionId, event.files);
      return;
    case "config-options": {
      logInfo(
        `[tiller-helm] session.config.options session=${sessionId} model=${event.state.model ?? "<none>"} reasoning=${event.state.reasoningEffort ?? "<none>"} options=${event.options.length}`,
      );
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
    case "model-options": {
      logInfo(
        `[tiller-helm] session.model.options session=${sessionId} currentModel=${event.state.currentModelId ?? "<none>"} options=${event.state.options.length}`,
      );
      const updated = updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: event.state.currentModelId ?? current.model,
        modelOptions: event.state.options,
        updatedAt: new Date().toISOString(),
      }));
      broadcastAuthenticated({
        type: "session.model.options",
        sessionId,
        currentModelId: event.state.currentModelId,
        options: event.state.options,
      });
      if (!updated) {
        return;
      }
      broadcastAuthenticated({
        type: "session.updated",
        requestId: `session-model-${Date.now()}`,
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
      modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
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

async function publishDiffUpdate(sessionId: string, files: FileDiffSummary[]) {
  const diffs = await hydrateDiffsFromWorkspaceGit(sessionId, files);
  sessionArtifactStore.replaceDiffs(sessionId, diffs);
  broadcastAuthenticated({
    type: "diff.update",
    sessionId,
    files: diffs,
  });
}

async function hydrateDiffsFromWorkspaceGit(sessionId: string, files: FileDiffSummary[]) {
  const workspace = resolveSessionWorkspace(sessionId);
  if (!workspace) {
    return files;
  }

  const gitDiffs = await readWorkspaceGitDiffs(workspace.path);
  if (!gitDiffs.length) {
    return files;
  }

  if (!files.length) {
    return gitDiffs;
  }

  const gitByPath = new Map(gitDiffs.map((file) => [normalizeDiffPath(file.path), file]));
  return files.map((file) => {
    const fromGit = gitByPath.get(normalizeDiffPath(file.path));
    return fromGit ? { ...file, additions: fromGit.additions, deletions: fromGit.deletions, patch: file.patch ?? fromGit.patch } : file;
  });
}

function resolveSessionWorkspace(sessionId: string) {
  const liveWorkspace = sessions.get(sessionId)?.workspace;
  if (liveWorkspace) {
    return liveWorkspace;
  }

  const summary = sessionStore.list().find((item) => item.id === sessionId);
  return summary ? workspaces.find((workspace) => workspace.id === summary.workspaceId) ?? null : null;
}

async function readWorkspaceGitDiffs(workspacePath: string): Promise<FileDiffSummary[]> {
  try {
    const [nameStatusResult, numstatResult] = await Promise.all([
      execFileAsync("git", ["-C", workspacePath, "diff", "--name-status", "HEAD", "--"], { maxBuffer: GIT_DIFF_MAX_BUFFER }),
      execFileAsync("git", ["-C", workspacePath, "diff", "--numstat", "HEAD", "--"], { maxBuffer: GIT_DIFF_MAX_BUFFER }),
    ]);
    const statsByPath = parseGitNumstat(numstatResult.stdout);
    const files = parseGitNameStatus(nameStatusResult.stdout);
    const trackedDiffs = await Promise.all(
      files.map(async (file) => {
        const stats = statsByPath.get(normalizeDiffPath(file.path));
        const patch = await readWorkspaceGitPatch(workspacePath, file.path);
        return {
          ...file,
          additions: stats?.additions ?? countPatchLines(patch, "+"),
          deletions: stats?.deletions ?? countPatchLines(patch, "-"),
          ...(patch ? { patch } : {}),
        };
      }),
    );
    const untrackedDiffs = await readWorkspaceUntrackedDiffs(workspacePath);
    return [...trackedDiffs, ...untrackedDiffs];
  } catch {
    return [];
  }
}

async function readWorkspaceGitPatch(workspacePath: string, filePath: string) {
  try {
    const result = await execFileAsync("git", ["-C", workspacePath, "diff", "--no-ext-diff", "HEAD", "--", filePath], { maxBuffer: GIT_DIFF_MAX_BUFFER });
    const patch = result.stdout.trimEnd();
    return patch || undefined;
  } catch {
    return undefined;
  }
}

async function readWorkspaceUntrackedDiffs(workspacePath: string): Promise<FileDiffSummary[]> {
  try {
    const result = await execFileAsync("git", ["-C", workspacePath, "ls-files", "--others", "--exclude-standard", "-z"], { maxBuffer: GIT_DIFF_MAX_BUFFER });
    const files = result.stdout.split("\0").filter(Boolean);
    return Promise.all(files.map((filePath) => buildUntrackedFileDiff(workspacePath, filePath)));
  } catch {
    return [];
  }
}

async function buildUntrackedFileDiff(workspacePath: string, filePath: string): Promise<FileDiffSummary> {
  try {
    const absoluteWorkspace = resolve(workspacePath);
    const absoluteFile = resolve(absoluteWorkspace, filePath);
    if (absoluteFile !== absoluteWorkspace && !absoluteFile.startsWith(`${absoluteWorkspace}${sep}`)) {
      return { path: filePath, status: "added", additions: 0, deletions: 0 };
    }

    const content = await readFile(absoluteFile, "utf8");
    const patch = buildAddedFilePatch(filePath, content);
    return {
      path: filePath,
      status: "added",
      additions: countPatchLines(patch, "+"),
      deletions: 0,
      patch,
    };
  } catch {
    return { path: filePath, status: "added", additions: 0, deletions: 0 };
  }
}

function buildAddedFilePatch(filePath: string, content: string) {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent ? normalizedContent.replace(/\n$/u, "").split("\n") : [];
  const body = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ].filter(Boolean).join("\n");
}

function parseGitNameStatus(output: string): FileDiffSummary[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusToken = "M", ...paths] = line.split(/\t+/u);
      const path = paths.at(-1) ?? "";
      return {
        path,
        status: statusToken.startsWith("A") ? "added" as const : statusToken.startsWith("D") ? "deleted" as const : "modified" as const,
        additions: 0,
        deletions: 0,
      };
    })
    .filter((file) => Boolean(file.path));
}

function parseGitNumstat(output: string) {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split(/\r?\n/u)) {
    const [additionsRaw, deletionsRaw, ...paths] = line.split(/\t+/u);
    const path = paths.at(-1);
    if (!path) {
      continue;
    }
    stats.set(normalizeDiffPath(path), {
      additions: parseGitStatNumber(additionsRaw),
      deletions: parseGitStatNumber(deletionsRaw),
    });
  }
  return stats;
}

function parseGitStatNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDiffPath(path: string) {
  return path.replace(/\\/g, "/");
}

function countPatchLines(patch: string | undefined, marker: "+" | "-") {
  if (!patch) {
    return 0;
  }

  const ignoredPrefix = marker === "+" ? "+++" : "---";
  return patch.split(/\r?\n/u).filter((line) => line.startsWith(marker) && !line.startsWith(ignoredPrefix)).length;
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

function dedupeWorkspaces(items: WorkspaceSummary[]) {
  const seen = new Set<string>();
  const next: WorkspaceSummary[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function loadAvailableWorkspaces() {
  const config = readTillerConfig(configPath);
  const configuredWorkspaces = config.workspaces ?? [];
  const projectWorkspaces = (config.projects ?? [])
    .filter((project) => project.path?.trim())
    .map((project) => ({
      id: project.defaultWorkspaceId ?? project.workspaceIds?.[0] ?? `${project.id}-workspace`,
      name: project.name,
      path: project.path!.replace(/\\/g, "/"),
    } satisfies WorkspaceSummary));
  const mergedWorkspaces = dedupeWorkspaces([...configuredWorkspaces, ...projectWorkspaces]);
  if (mergedWorkspaces.length) {
    return mergedWorkspaces;
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


async function loadAvailableProjectsWithSemanticSummaries() {
  const baseProjects = loadAvailableProjects();
  return Promise.all(baseProjects.map((project) => enrichProjectSummary(project)));
}

async function enrichProjectSummary(project: ProjectSummary): Promise<ProjectSummary> {
  const helm = resolveHelmById(project.helmId, loadAvailableHelms());
  const modelConfig = helm?.modelConfig;
  if (!modelConfig?.baseUrl?.trim() || !modelConfig.model?.trim()) {
    return project;
  }

  const projectWorkspaces = resolveProjectWorkspaces(project, loadAvailableWorkspaces());
  const cacheKey = [project.id, project.summary ?? "", modelConfig.baseUrl, modelConfig.model, projectWorkspaces.map((workspace) => `${workspace.id}:${workspace.path}`).join("|")].join("::");
  const cached = projectSemanticSummaryCache.get(cacheKey);
  if (cached) {
    return { ...project, summary: cached };
  }

  try {
    const source = await collectProjectSummarySource(project, projectWorkspaces);
    const semanticSummary = await requestHelmModelSummary(modelConfig, source);
    const summary = semanticSummary.trim() || project.summary;
    if (!summary) {
      return project;
    }
    projectSemanticSummaryCache.set(cacheKey, summary);
    return { ...project, summary };
  } catch (error) {
    logInfo(`[tiller-helm] project.summary.semantic.skip project=${project.id} reason=${error instanceof Error ? error.message : "unknown"}`);
    return project;
  }
}

function resolveProjectWorkspaces(project: ProjectSummary, availableWorkspaces: WorkspaceSummary[]) {
  return project.workspaceIds?.length
    ? availableWorkspaces.filter((workspace) => project.workspaceIds?.includes(workspace.id))
    : availableWorkspaces;
}

async function collectProjectSummarySource(project: ProjectSummary, projectWorkspaces: WorkspaceSummary[]) {
  const snippets = await Promise.all(projectWorkspaces.slice(0, 3).map(async (workspace) => {
    const readme = await readOptionalSnippet(resolve(workspace.path, "README.md"), 1800);
    const packageJson = await readOptionalSnippet(resolve(workspace.path, "package.json"), 1200);
    return [
      `Workspace: ${workspace.name}`,
      `Path: ${workspace.path}`,
      workspace.summary ? `Rule summary: ${workspace.summary}` : "",
      readme ? `README excerpt:\n${readme}` : "",
      packageJson ? `package.json excerpt:\n${packageJson}` : "",
    ].filter(Boolean).join("\n");
  }));

  return [
    `Project: ${project.name}`,
    project.summary ? `Existing summary: ${project.summary}` : "",
    ...snippets,
  ].filter(Boolean).join("\n\n").slice(0, 8000);
}

async function readOptionalSnippet(path: string, maxLength: number) {
  try {
    return (await readFile(path, "utf8")).slice(0, maxLength);
  } catch {
    return "";
  }
}

async function requestHelmModelSummary(modelConfig: NonNullable<HelmSummary["modelConfig"]>, source: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(resolveHelmModelChatUrl(modelConfig.baseUrl ?? ""), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(modelConfig.apiKey?.trim() ? { Authorization: `Bearer ${modelConfig.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: modelConfig.model?.trim(),
        temperature: 0.1,
        messages: [
          { role: "system", content: "Summarize this software project for a coding-agent prompt context. Return 3-5 concise bullet points. No markdown fence." },
          { role: "user", content: source },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`summary model failed: ${response.status}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function resolveHelmModelChatUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  if (/\/v\d+(?:\/|$)/.test(trimmed)) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
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
    sessionModelState?: AcpModelState;
    prompt: (text: string) => void;
    configure: (next: { model?: string; reasoningEffort?: SessionReasoningEffort }) => Promise<{
      runtimeApplied: boolean;
      state: { model?: string; reasoningEffort?: SessionReasoningEffort };
      modelState?: AcpModelState;
    }>;
    respondPermission: (requestId: string, decision: "allow" | "deny") => void;
    cancel: () => void;
    supportsPermissionResponses: boolean;
  };
};



