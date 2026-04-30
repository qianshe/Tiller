import { WebSocket, WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
import { createAuthenticatedSocketRegistry } from "./auth/socket-registry";
import { createHelmSessionStores, resolveSessionStoreBackend } from "./sessions/store-factory";
import { type StoredSessionRuntimeDescriptor } from "./sessions/runtime-store";
import { resolveSessionCleanupOutcome } from "./sessions/cleanup";
import { loadOpenCodeExportHistory } from "./sessions/opencode-export";
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "./sessions/summary-updates";
import { normalizeDiffPath, readWorkspaceGitDiffs } from "./sessions/git-diff";
import { createTrustedDeviceStore } from "./auth/beacon-store";
import { handleConfigMessage, refreshProjectGitBranches } from "./handlers/config";
import { handleDeviceMessage } from "./handlers/devices";
import { handleSessionMessage } from "./handlers/sessions";
import type { HelmHandlerContext } from "./handlers/context";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./runtime-events";

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
const sessionsSqlitePath = resolve(dirname(configPath), "sessions.sqlite");
const trustedDevicesPath = resolve(dirname(configPath), "trusted-devices.json");
const {
  sessionStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionRuntimeStore,
} = createHelmSessionStores({
  backend: resolveSessionStoreBackend(),
  sqlitePath: sessionsSqlitePath,
  jsonPaths: {
    sessionHistoryPath,
    sessionMessagesPath,
    sessionArtifactsPath,
    sessionRuntimesPath,
  },
  logInfo,
  logError,
});
const trustedDeviceStore = createTrustedDeviceStore(trustedDevicesPath);
const authenticatedSockets = createAuthenticatedSocketRegistry<WebSocket>();
const socketIds = new WeakMap<WebSocket, string>();
let nextSocketSequence = 0;
const configStub = loadTillerConfigStub(configPath);
normalizeProjectIdsOnStartup();
let helms = loadAvailableHelms();
let workspaces = loadAvailableWorkspaces();
let agents = listAvailableProviders(configPath);
let projects = loadAvailableProjects();
await refreshProjectGitBranchesOnStartup();
normalizeProjectAgentDefaultsOnStartup();
projects = loadAvailableProjects();
const sessions = new Map<string, SessionRecord>();
const permissionIndex = new Map<string, { sessionId: string; request: PermissionRequest }>();
const projectContextSummaryCache = new Map<string, string>();

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

async function refreshProjectGitBranchesOnStartup() {
  const result = await refreshProjectGitBranches(projects, workspaces, configPath);
  projects = loadAvailableProjects();
  workspaces = loadAvailableWorkspaces();
  if (result.updated || result.failures.length) {
    logInfo(`[tiller-helm] project.git.refresh updated=${result.updated} skipped=${result.skipped} failed=${result.failures.length}`);
  }
  for (const failure of result.failures) {
    logError(`[tiller-helm] project.git.refresh.failed project=${failure.projectId} message=${failure.message}`);
  }
}

function normalizeProjectIdsOnStartup() {
  const config = readTillerConfig(configPath);
  const configuredProjects = config.projects ?? [];
  if (!configuredProjects.length) {
    return;
  }

  const idMap = new Map<string, string>();
  const nextProjects = configuredProjects.map((project, index) => {
    const nextId = `project-${index + 1}`;
    idMap.set(project.id, nextId);
    if (project.id === nextId) {
      return project;
    }
    return {
      ...project,
      id: nextId,
      workspaceIds: project.workspaceIds?.map((workspaceId) => remapProjectScopedId(workspaceId, project.id, nextId)),
      defaultWorkspaceId: project.defaultWorkspaceId ? remapProjectScopedId(project.defaultWorkspaceId, project.id, nextId) : project.defaultWorkspaceId,
    };
  });

  const changed = nextProjects.some((project, index) => project.id !== configuredProjects[index]?.id);
  if (!changed) {
    return;
  }

  const nextWorkspaces = (config.workspaces ?? []).map((workspace) => {
    for (const [oldId, nextId] of idMap) {
      const remappedId = remapProjectScopedId(workspace.id, oldId, nextId);
      if (remappedId !== workspace.id) {
        return { ...workspace, id: remappedId };
      }
    }
    return workspace;
  });

  writeFileSync(configPath, JSON.stringify({ ...config, projects: nextProjects, workspaces: nextWorkspaces }, null, 2), "utf8");
  for (const summary of sessionStore.list()) {
    const nextProjectId = idMap.get(summary.projectId);
    if (nextProjectId && nextProjectId !== summary.projectId) {
      sessionStore.upsert({ ...summary, projectId: nextProjectId });
    }
  }
  for (const descriptor of sessionRuntimeStore.list()) {
    const nextProjectId = descriptor.projectId ? idMap.get(descriptor.projectId) : undefined;
    if (nextProjectId && nextProjectId !== descriptor.projectId) {
      sessionRuntimeStore.upsert({ ...descriptor, projectId: nextProjectId });
    }
  }
  logInfo(`[tiller-helm] project.id.normalize updated=${nextProjects.length}`);
}

function remapProjectScopedId(value: string, oldProjectId: string, nextProjectId: string) {
  if (value === `${oldProjectId}-workspace`) {
    return `${nextProjectId}-workspace`;
  }
  if (value.startsWith(`${oldProjectId}-worktree-`)) {
    return `${nextProjectId}${value.slice(oldProjectId.length)}`;
  }
  return value;
}

function normalizeProjectAgentDefaultsOnStartup() {
  const availableAgents = listAvailableProviders(configPath);
  let updated = 0;
  for (const project of listConfiguredProjects(configPath)) {
    const nextDefaultAgentId = resolveDefaultProjectAgentId(project, availableAgents);
    if (nextDefaultAgentId && project.defaultAgentId !== nextDefaultAgentId) {
      saveProjectToConfig({ ...project, defaultAgentId: nextDefaultAgentId }, configPath);
      updated += 1;
    }
  }
  if (updated) {
    logInfo(`[tiller-helm] project.agent.default updated=${updated} default=codex`);
  }
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
  const context = createHandlerContext();
  if (await handleDeviceMessage(socket, payload, context)) return;
  if (await handleConfigMessage(socket, payload, context)) return;
  if (await handleSessionMessage(socket, payload, context)) return;
}

function createHandlerContext(): HelmHandlerContext {
  return {
    configPath,
    emit,
    broadcastAuthenticated,
    logInfo,
    logError,
    getHelms: () => helms,
    setHelms: (items) => { helms = items; },
    loadAvailableHelms,
    getWorkspaces: () => workspaces,
    setWorkspaces: (items) => { workspaces = items; },
    loadAvailableWorkspaces,
    getAgents: () => agents,
    setAgents: (items) => { agents = items; },
    loadAvailableAgents: () => listAvailableProviders(configPath),
    getProjects: () => projects,
    setProjects: (items) => { projects = items; },
    loadAvailableProjectsWithSemanticSummaries,
    trustedDeviceStore,
    authenticatedSockets,
    toTrustedDeviceSummary,
    sessions,
    permissionIndex,
    sessionStore,
    sessionMessageStore,
    sessionArtifactStore,
    sessionRuntimeStore,
    createRuntime: createAcpRuntime,
    testAcpConnection,
    resolveHelmById,
    resolveProjectById,
    resolveProviderById,
    probeAgentModelOptions,
    startSessionResume,
    handleRuntimeEvent,
    hydrateSessionSummary,
    migrateStoredSessionSummary,
    buildResumeInfo,
    persistRuntimeDescriptor,
    updateSessionSummary,
    persistSessionMessage,
    publishDiffUpdate,
    hydrateDiffsFromWorkspaceGit,
    clearPermissionRequestsForSession,
    deleteLocalSessionData,
  };
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
  dispatchRuntimeEvent(sessionId, event, createHandlerContext());
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
  const inferredProject = inferProjectFromSessionHistory(summary.id);
  if (inferredProject) {
    return {
      ...summary,
      projectId: inferredProject.id,
      projectName: inferredProject.name,
      helmId: inferredProject.helmId,
      workspaceId: inferredProject.defaultWorkspaceId ?? inferredProject.workspaceIds?.[0] ?? summary.workspaceId,
    };
  }

  const exactProject = resolveProjectById(summary.projectId, projects);
  const workspaceProject = projects.find((project) => project.workspaceIds?.includes(summary.workspaceId));
  if (exactProject && workspaceProject && workspaceProject.id !== exactProject.id) {
    return {
      ...summary,
      projectId: workspaceProject.id,
      projectName: workspaceProject.name,
      helmId: workspaceProject.helmId,
    };
  }
  if (exactProject) {
    return {
      ...summary,
      projectName: exactProject.name,
      helmId: exactProject.helmId,
    };
  }

  const matchedProject =
    projects.find((project) => project.name === summary.projectName) ??
    workspaceProject;
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

function inferProjectFromSessionHistory(sessionId: string) {
  const text = sessionMessageStore.list(sessionId).map((message) => message.text).join("\n").toLowerCase();
  if (!text) {
    return null;
  }
  const scored = projects
    .map((project) => {
      const name = project.name.toLowerCase();
      const path = project.path?.toLowerCase().replaceAll("\\", "/");
      const score =
        (path && text.includes(path) ? 4 : 0) +
        (name && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}([^\\p{L}\\p{N}]|$)`, "iu").test(text) ? 2 : 0);
      return { project, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!scored.length || scored[0].score < 2 || scored[0].score === scored[1]?.score) {
    return null;
  }
  return scored[0].project;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    sessionClose: Boolean(runtimeCapabilities?.sessionClose ?? descriptor?.capabilities?.sessionClose ?? agent?.capabilities?.sessionClose),
    sessionDelete: Boolean(runtimeCapabilities?.sessionDelete ?? descriptor?.capabilities?.sessionDelete ?? agent?.capabilities?.sessionDelete),
  };
}

function resolveResumeMode(agent: AcpAgentProvider | undefined) {
  if (agent?.capabilities?.sessionLoad || agent?.capabilities?.sessionResume) {
    return "reconnect";
  }

  return agent?.capabilities?.resumeMode ?? "none";
}

async function importAuthoritativeOpenCodeHistory(sessionId: string, agent: AcpAgentProvider, runtimeSessionId: string, cwd: string) {
  try {
    const history = await loadOpenCodeExportHistory(agent, runtimeSessionId, cwd);
    if (!history) {
      return;
    }
    if (history.messages.length) {
      sessionMessageStore.replace(sessionId, history.messages);
    }
    if (history.toolCalls.length) {
      sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
    }
    logInfo(`[tiller-helm] opencode.export.history session=${sessionId} runtime=${runtimeSessionId} messages=${history.messages.length} toolCalls=${history.toolCalls.length}`);
  } catch (error) {
    logError(`[tiller-helm] opencode.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "OpenCode export failed."}`);
  }
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
    await importAuthoritativeOpenCodeHistory(sessionId, agent, runtime.runtimeSessionId, workspace.path);
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
  if (
    !summary.runtimeSessionId &&
    !resolvedCapabilities.sessionLoad &&
    !resolvedCapabilities.sessionResume &&
    !resolvedCapabilities.sessionList &&
    !resolvedCapabilities.sessionClose &&
    !resolvedCapabilities.sessionDelete
  ) {
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

function loadAvailableProjects(): ProjectSummary[] {
  const configuredProjects = listConfiguredProjects(configPath);
  const availableAgents = listAvailableProviders(configPath);
  if (configuredProjects.length) {
    return configuredProjects.map((project) => ({
      ...project,
      defaultAgentId: resolveDefaultProjectAgentId(project, availableAgents),
    }));
  }

  const fallbackHelm = loadAvailableHelms()[0];
  const fallbackWorkspaces = loadAvailableWorkspaces();
  return [
    {
      id: "current-project",
      name: basename(REPO_ROOT),
      helmId: fallbackHelm.id,
      workspaceIds: fallbackWorkspaces.map((workspace) => workspace.id),
      allowedAgentIds: availableAgents.map((agent) => agent.id),
      defaultWorkspaceId: fallbackWorkspaces[0]?.id,
      defaultAgentId: resolveDefaultProjectAgentId({ allowedAgentIds: availableAgents.map((agent) => agent.id) } as ProjectSummary, availableAgents),
    },
  ] satisfies ProjectSummary[];
}

function resolveDefaultProjectAgentId(project: ProjectSummary, agents: AcpAgentProvider[]) {
  const allowedAgentIds = project.allowedAgentIds?.length ? new Set(project.allowedAgentIds) : null;
  const codex = agents.find((agent) => agent.id === "codex" && (!allowedAgentIds || allowedAgentIds.has(agent.id)));
  return codex?.id ?? project.defaultAgentId ?? agents.find((agent) => !allowedAgentIds || allowedAgentIds.has(agent.id))?.id;
}


async function loadAvailableProjectsWithSemanticSummaries() {
  const baseProjects = loadAvailableProjects();
  return Promise.all(baseProjects.map((project) => enrichProjectSummary(project)));
}

async function enrichProjectSummary(project: ProjectSummary): Promise<ProjectSummary> {
  const projectWorkspaces = resolveProjectWorkspaces(project, loadAvailableWorkspaces());
  const cacheKey = [project.id, project.summary ?? "", projectWorkspaces.map((workspace) => `${workspace.id}:${workspace.path}:${workspace.summary ?? ""}`).join("|")].join("::");
  const cached = projectContextSummaryCache.get(cacheKey);
  if (cached) {
    return { ...project, summary: cached };
  }

  const source = await collectProjectSummarySource(project, projectWorkspaces);
  const summary = compactProjectContextSource(source) || project.summary;
  if (!summary) {
    return project;
  }
  projectContextSummaryCache.set(cacheKey, summary);
  return { ...project, summary };
}

function resolveProjectWorkspaces(project: ProjectSummary, availableWorkspaces: WorkspaceSummary[]) {
  return project.workspaceIds?.length
    ? availableWorkspaces.filter((workspace) => project.workspaceIds?.includes(workspace.id))
    : availableWorkspaces;
}

function sanitizeConfiguredProjectSummary(projectName: string, summary: string | undefined) {
  const normalized = summary?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const generatedPrefix = `Project: ${projectName} Configured summary:`;
  const withoutGeneratedPrefix = normalized.includes(generatedPrefix)
    ? normalized.split(generatedPrefix).map((part) => part.trim()).filter(Boolean)[0] ?? normalized.replaceAll(generatedPrefix, "").trim()
    : normalized;
  const compact = withoutGeneratedPrefix || normalized;
  return compact.length > 900 ? `${compact.slice(0, 900)}…` : compact;
}

async function collectProjectSummarySource(project: ProjectSummary, projectWorkspaces: WorkspaceSummary[]) {
  const configuredSummary = sanitizeConfiguredProjectSummary(project.name, project.summary);
  const snippets = await Promise.all(projectWorkspaces.slice(0, 3).map(async (workspace) => {
    const agents = await readOptionalSnippet(resolve(workspace.path, "AGENTS.md"), 2800);
    const claude = await readOptionalSnippet(resolve(workspace.path, "CLAUDE.md"), 2200);
    const readme = await readOptionalSnippet(resolve(workspace.path, "README.md"), 1600);
    const packageJson = await readOptionalSnippet(resolve(workspace.path, "package.json"), 1000);
    return [
      `Workspace: ${workspace.name}`,
      `Path: ${workspace.path}`,
      workspace.summary ? `Workspace summary: ${workspace.summary}` : "",
      agents ? `AGENTS.md:\n${agents}` : "",
      claude ? `CLAUDE.md:\n${claude}` : "",
      readme ? `README.md:\n${readme}` : "",
      packageJson ? `package.json:\n${packageJson}` : "",
    ].filter(Boolean).join("\n");
  }));

  return [
    `Project: ${project.name}`,
    configuredSummary ? `Configured summary: ${configuredSummary}` : "",
    ...snippets,
  ].filter(Boolean).join("\n\n").slice(0, 9000);
}

function compactProjectContextSource(source: string) {
  return source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 72)
    .join("\n")
    .slice(0, 5000);
}

async function readOptionalSnippet(path: string, maxLength: number) {
  try {
    return (await readFile(path, "utf8")).slice(0, maxLength);
  } catch {
    return "";
  }
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
