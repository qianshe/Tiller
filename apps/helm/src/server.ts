import { WebSocket, WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, resolve } from "node:path";
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
import { createAcpRuntime, testAcpConnection, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import {
  isWildcardHost,
  type AcpAgentProvider,
  type AcpModelState,
  type AgentMessage,
  type AgentPromptContent,
  type FileDiffSummary,
  type HelmSummary,
  type PermissionRequest,
  type ProjectSummary,
  type SessionReasoningEffort,
  type SessionResumeInfo,
  type SessionSummary,
  type TrustedDeviceSummary,
  type WorkspaceSummary,
} from "@tiller/shared";
import { createHelmSessionStores, resolveSessionStoreBackend } from "./sessions/store-factory";
import { type StoredSessionRuntimeDescriptor } from "./sessions/runtime-store";
import { resolveSessionCleanupOutcome } from "./sessions/cleanup";
import { loadProviderAuthoritativeHistory } from "./sessions/opencode-export";
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "./sessions/summary-updates";
import { alignSessionProjectBinding } from "./sessions/project-binding";
import { normalizeDiffPath, readWorkspaceGitDiffs } from "./sessions/git-diff";
import { createTrustedDeviceStore } from "./auth/beacon-store";
import { createSocketAuthenticator } from "./auth/socket-auth";
import { handleConfigMessage } from "./handlers/config/legacy";
import { handleDeviceMessage } from "./handlers/devices";
import { handleSessionMessage } from "./handlers/sessions/legacy";
import type { HelmHandlerContext } from "./handlers/context";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./runtime/events";
import { assertHelmPortAvailable, resolveLanAddresses } from "./runtime/port-availability";
import { resolveTillerRuntimeOptions } from "./runtime/options";
import { loadStaticAsset, resolveDeckStaticDir } from "./runtime/static-assets";
import { createTillerLogger } from "./logging/logger";
import { createPairingState } from "./state/pairing";
import { createSocketState } from "./state/socket";

// Tiller verification ping by Antigravity 🐾
const configPath = getDefaultConfigPath();
const configStub = loadTillerConfigStub(configPath);
const tillerConfig = readTillerConfig(configPath);
const {
  host: HOST,
  port: PORT,
  authMode: AUTH_MODE,
} = resolveTillerRuntimeOptions({ config: tillerConfig });
const DEFAULT_WORKSPACE_ROOT = process.cwd();
const LOGS_DIR = resolve(dirname(configPath), "logs");
const DECK_STATIC_DIR = resolveDeckStaticDir(import.meta.url);

const logger = createTillerLogger({ logsDir: LOGS_DIR });
const { logInfo, logDebug, logWarn, logError } = logger;
const TILLER_LOG_FILE = logger.logFile;

const sessionHistoryPath = resolve(dirname(configPath), "sessions.json");
const sessionMessagesPath = resolve(dirname(configPath), "session-messages");
const sessionArtifactsPath = resolve(dirname(configPath), "session-artifacts");
const sessionRuntimesPath = resolve(dirname(configPath), "session-runtimes.json");
const sessionsSqlitePath = resolve(dirname(configPath), "sessions.sqlite");
const trustedDevicesPath = resolve(dirname(configPath), "trusted-devices.json");
const { sessionStore, sessionMessageStore, sessionArtifactStore, sessionRuntimeStore } =
  createHelmSessionStores({
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
const socketState = createSocketState<WebSocket>();
const { registry: authenticatedSockets, getSocketId } = socketState;
let helms = loadAvailableHelms();
let workspaces = loadAvailableWorkspaces();
let agents = listAvailableProviders(configPath);
let projects = loadAvailableProjects();
normalizeProjectAgentDefaultsOnStartup();
projects = loadAvailableProjects();
const sessions = new Map<string, SessionRecord>();
const permissionIndex = new Map<string, { sessionId: string; request: PermissionRequest }>();
const projectContextSummaryCache = new Map<string, string>();
const openCodeHistoryRefreshes = new Map<string, number>();

// --- Device pairing state ---
const pairingState = createPairingState();

function showPairingCode() {
  const code = pairingState.ensureCode();
  const pairUrl = `http://${resolvePrimaryDisplayHost()}:${PORT}?pair=${code}`;
  console.log(`[tiller] Pairing code: ${code}`);
  console.log("[tiller] Scan QR code or enter pairing code to connect:");
  qrcode.generate(pairUrl, { small: true }, (qr: string) => {
    console.log(qr);
  });
}

const beginAuthenticationFlow = createSocketAuthenticator({
  authMode: AUTH_MODE,
  authenticatedSockets,
  getSocketId,
  trustedDeviceStore,
  pairingState,
  showPairingCode,
  reply,
  handleMessage,
  logInfo,
  logError,
});

function normalizeProjectAgentDefaultsOnStartup() {
  const availableAgents = listAvailableProviders(configPath);
  let updated = 0;
  for (const project of listConfiguredProjects(configPath)) {
    const nextDefaultAgentId = resolveDefaultProjectAgentId(
      availableAgents,
      project.defaultAgentId,
    );
    if (nextDefaultAgentId && project.defaultAgentId !== nextDefaultAgentId) {
      saveProjectToConfig({ ...project, defaultAgentId: nextDefaultAgentId }, configPath);
      updated += 1;
    }
  }
  if (updated) {
    logInfo(`[tiller] project.agent.default updated=${updated} default=codex`);
  }
}

try {
  await assertHelmPortAvailable({ host: HOST, port: PORT });
} catch (error) {
  logError(`[tiller] startup blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const httpServer = createServer(handleHttpRequest);
const server = new WebSocketServer({ server: httpServer });

server.on("connection", (socket) => {
  logInfo("[tiller] client connected");

  socket.on("close", () => {
    logInfo("[tiller] client disconnected");
    authenticatedSockets.remove(getSocketId(socket));
  });

  beginAuthenticationFlow(socket);
});

httpServer.listen(PORT, HOST);

httpServer.on("listening", () => {
  logInfo(`[tiller] listening on http://${HOST}:${PORT}`);
  for (const url of resolveDisplayUrls()) {
    logInfo(`[tiller] Deck available at ${url}`);
  }
  logInfo(`[tiller] WebSocket available on the same origin`);
  logInfo(`[tiller] auth mode: ${AUTH_MODE}`);
  logInfo(
    `[tiller] config stub ${configStub.exists ? "found" : "not found"} at ${configStub.configPath}`,
  );
  logInfo(`[tiller] logs at ${TILLER_LOG_FILE}`);
});

httpServer.on("error", (error) => {
  logError(`[tiller] server error: ${error.message}`);
});

server.on("error", (error) => {
  logError(`[tiller] websocket error: ${error.message}`);
});

process.on("uncaughtException", (error) => {
  logError(`[tiller] uncaught exception: ${error.stack ?? error.message}`);
});

process.on("unhandledRejection", (reason) => {
  logError(
    `[tiller] unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
  );
});

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
    logDebug,
    logWarn,
    logError,
    getHelms: () => helms,
    setHelms: (items) => {
      helms = items;
    },
    loadAvailableHelms,
    getWorkspaces: () => workspaces,
    setWorkspaces: (items) => {
      workspaces = items;
    },
    loadAvailableWorkspaces,
    getAgents: () => agents,
    setAgents: (items) => {
      agents = items;
    },
    loadAvailableAgents: () => listAvailableProviders(configPath),
    getProjects: () => projects,
    setProjects: (items) => {
      projects = items;
    },
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
    refreshAuthoritativeSessionHistory,
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

  logInfo(
    `[tiller] agent.model.options.probe.start provider=${agent.id} workspace=${workspace.id}`,
  );

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
          logError(
            `[tiller] agent.model.options.probe.error provider=${agent.id} code=${event.code ?? "UNKNOWN"} message=${event.message}`,
          );
        }
      },
    });

    runtime.cancel();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to probe agent model options.";
    logError(
      `[tiller] agent.model.options.probe.failed provider=${agent.id} workspace=${workspace.id} message=${message}`,
    );
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
    `[tiller] agent.model.options.probe.result provider=${agent.id} workspace=${workspace.id} currentModel=${modelState?.currentModelId ?? configState.model ?? "<none>"} modelOptions=${modelCount} configOptions=${configOptions.length}`,
  );

  return {
    ok: modelCount > 0 || configOptions.length > 0,
    message:
      modelCount > 0 || configOptions.length > 0
        ? `Loaded ${modelCount || configOptions.length} model option(s).`
        : "Agent did not return model options.",
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

function updateSessionSummary(
  sessionId: string,
  mutate: (summary: SessionSummary) => SessionSummary,
) {
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
  persistRuntimeDescriptor(
    next,
    record?.agent ?? resolveProviderById(next.agentId, agents),
    record?.runtime.sessionCapabilities,
  );
  return next;
}

function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
  const aligned = alignSessionProjectBinding(summary, projects);
  const record = sessions.get(summary.id);
  const agent = record?.agent ?? resolveProviderById(aligned.agentId, agents);
  const descriptor = sessionRuntimeStore.get(summary.id);
  const capabilities = resolveSessionRestoreCapabilities(
    agent,
    descriptor,
    record?.runtime.sessionCapabilities,
  );
  return {
    ...aligned,
    imageInput: capabilities.imageInput,
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

function buildResumeInfo(
  summary: SessionSummary,
  agent: AcpAgentProvider | undefined,
): SessionResumeInfo {
  const activeRecord = sessions.get(summary.id);
  const descriptor = sessionRuntimeStore.get(summary.id);
  const checkedAt = new Date().toISOString();
  const runtimeSessionId =
    summary.runtimeSessionId ??
    activeRecord?.runtime.runtimeSessionId ??
    descriptor?.runtimeSessionId;
  const capabilities = resolveSessionRestoreCapabilities(
    agent,
    descriptor,
    activeRecord?.runtime.sessionCapabilities,
  );

  if (activeRecord) {
    return {
      mode: "same-process",
      state: "resume-available",
      reason:
        "Client can reconnect to the still-running Helm session; ACP restore is not required.",
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
    reason:
      "ACP agent restore is unavailable; Tiller can only restore UI history recorded by Helm.",
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
    sessionLoad: Boolean(
      runtimeCapabilities?.sessionLoad ??
      descriptor?.capabilities?.sessionLoad ??
      agent?.capabilities?.sessionLoad,
    ),
    sessionResume: Boolean(
      runtimeCapabilities?.sessionResume ??
      descriptor?.capabilities?.sessionResume ??
      agent?.capabilities?.sessionResume,
    ),
    sessionList: Boolean(
      runtimeCapabilities?.sessionList ??
      descriptor?.capabilities?.sessionList ??
      agent?.capabilities?.sessionList,
    ),
    sessionClose: Boolean(
      runtimeCapabilities?.sessionClose ??
      descriptor?.capabilities?.sessionClose ??
      agent?.capabilities?.sessionClose,
    ),
    sessionDelete: Boolean(
      runtimeCapabilities?.sessionDelete ??
      descriptor?.capabilities?.sessionDelete ??
      agent?.capabilities?.sessionDelete,
    ),
    imageInput: Boolean(
      runtimeCapabilities?.imageInput ??
      descriptor?.capabilities?.imageInput ??
      agent?.capabilities?.imageInput,
    ),
  };
}

function resolveResumeMode(agent: AcpAgentProvider | undefined) {
  if (agent?.capabilities?.sessionLoad || agent?.capabilities?.sessionResume) {
    return "reconnect";
  }

  return agent?.capabilities?.resumeMode ?? "none";
}

async function importAuthoritativeOpenCodeHistory(
  sessionId: string,
  agent: AcpAgentProvider,
  runtimeSessionId: string,
  cwd: string,
) {
  try {
    const history = await loadProviderAuthoritativeHistory(agent, runtimeSessionId, cwd);
    if (!history) {
      return false;
    }
    if (history.messages.length) {
      sessionMessageStore.replace(sessionId, history.messages);
    }
    if (history.toolCalls.length) {
      sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
    }
    logInfo(
      `[tiller] opencode.export.history session=${sessionId} runtime=${runtimeSessionId} messages=${history.messages.length} toolCalls=${history.toolCalls.length}`,
    );
    return true;
  } catch (error) {
    logError(
      `[tiller] opencode.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "OpenCode export failed."}`,
    );
    return false;
  }
}

async function refreshAuthoritativeSessionHistory(sessionId: string) {
  const lastRefresh = openCodeHistoryRefreshes.get(sessionId);
  if (lastRefresh && Date.now() - lastRefresh < 30_000) {
    return;
  }

  const activeRecord = sessions.get(sessionId);
  const summary =
    activeRecord?.summary ?? sessionStore.list().find((item) => item.id === sessionId);
  if (!summary) {
    return;
  }
  const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, agents);
  const workspace =
    activeRecord?.workspace ?? workspaces.find((item) => item.id === summary.workspaceId);
  const runtimeSessionId =
    activeRecord?.runtime.runtimeSessionId ??
    summary.runtimeSessionId ??
    sessionRuntimeStore.get(sessionId)?.runtimeSessionId;
  if (!agent || !workspace || !runtimeSessionId) {
    return;
  }

  const refreshed = await importAuthoritativeOpenCodeHistory(
    sessionId,
    agent,
    runtimeSessionId,
    workspace.path,
  );
  if (refreshed) {
    openCodeHistoryRefreshes.set(sessionId, Date.now());
  }
}

async function startSessionResume(sessionId: string) {
  const activeRecord = sessions.get(sessionId);
  if (activeRecord) {
    await refreshAuthoritativeSessionHistory(sessionId);
    const resume = buildResumeInfo(activeRecord.summary, activeRecord.agent);
    logInfo(
      `[tiller] client reconnect session=${sessionId} runtime=${resume.runtimeSessionId ?? "unknown"}`,
    );
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
  if (
    !agent ||
    !workspace ||
    !resume.runtimeSessionId ||
    (resume.restoreMethod !== "session/load" && resume.restoreMethod !== "session/resume")
  ) {
    return {
      ok: false,
      resume,
      message: resume.reason,
    };
  }

  try {
    logInfo(
      `[tiller] ACP restore begin session=${sessionId} runtime=${resume.runtimeSessionId} method=${resume.restoreMethod}`,
    );
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
    await importAuthoritativeOpenCodeHistory(
      sessionId,
      agent,
      runtime.runtimeSessionId,
      workspace.path,
    );
    logInfo(
      `[tiller] ACP restore success session=${sessionId} runtime=${runtime.runtimeSessionId} method=${resume.restoreMethod}`,
    );
    return {
      ok: true,
      resume: buildResumeInfo(restoredSummary, agent),
      message: `ACP ${resume.restoreMethod} completed for this session.`,
    };
  } catch (error) {
    logError(
      `[tiller] ACP restore failed session=${sessionId}: ${error instanceof Error ? error.message : "ACP restore failed."}`,
    );
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
  const resolvedCapabilities = resolveSessionRestoreCapabilities(
    agent,
    sessionRuntimeStore.get(summary.id),
    capabilities,
  );
  if (
    !summary.runtimeSessionId &&
    !resolvedCapabilities.sessionLoad &&
    !resolvedCapabilities.sessionResume &&
    !resolvedCapabilities.sessionList &&
    !resolvedCapabilities.sessionClose &&
    !resolvedCapabilities.sessionDelete &&
    !resolvedCapabilities.imageInput
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
    return fromGit
      ? {
          ...file,
          additions: fromGit.additions,
          deletions: fromGit.deletions,
          patch: file.patch ?? fromGit.patch,
        }
      : file;
  });
}

function resolveSessionWorkspace(sessionId: string) {
  const liveWorkspace = sessions.get(sessionId)?.workspace;
  if (liveWorkspace) {
    return liveWorkspace;
  }

  const summary = sessionStore.list().find((item) => item.id === sessionId);
  return summary
    ? (workspaces.find((workspace) => workspace.id === summary.workspaceId) ?? null)
    : null;
}

function emit(socket: WebSocket, payload: HelmToClient) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function toTrustedDeviceSummary(
  record: ReturnType<typeof trustedDeviceStore.list>[number],
): TrustedDeviceSummary {
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
  const configuredWorkspaces = dedupeWorkspaces(readTillerConfig(configPath).workspaces ?? []);
  if (configuredWorkspaces.length) {
    return configuredWorkspaces;
  }

  return [
    {
      id: "current-workspace",
      name: basename(DEFAULT_WORKSPACE_ROOT),
      path: DEFAULT_WORKSPACE_ROOT.replace(/\\/g, "/"),
    },
  ];
}

function loadAvailableProjects(): ProjectSummary[] {
  const configuredProjects = listConfiguredProjects(configPath);
  const availableAgents = listAvailableProviders(configPath);
  if (configuredProjects.length) {
    return configuredProjects.map((project) => ({
      ...project,
      defaultAgentId: resolveDefaultProjectAgentId(availableAgents, project.defaultAgentId),
    }));
  }

  const fallbackHelm = helms[0] ?? { id: "local-helm", name: "Local Helm", host: HOST, port: PORT };
  const fallbackWorkspaces = workspaces.length
    ? workspaces
    : [
        {
          id: "current-workspace",
          name: basename(DEFAULT_WORKSPACE_ROOT),
          path: DEFAULT_WORKSPACE_ROOT.replace(/\\/g, "/"),
        },
      ];
  return [
    {
      id: "current-project",
      name: basename(DEFAULT_WORKSPACE_ROOT),
      helmId: fallbackHelm.id,
      workspaceIds: fallbackWorkspaces.map((workspace) => workspace.id),
      defaultWorkspaceId: fallbackWorkspaces[0]?.id,
      defaultAgentId: resolveDefaultProjectAgentId(availableAgents, undefined),
    },
  ] satisfies ProjectSummary[];
}

function resolveDefaultProjectAgentId(
  agents: AcpAgentProvider[],
  existingDefaultAgentId: string | undefined,
) {
  const codex = agents.find((agent) => agent.id === "codex");
  return codex?.id ?? existingDefaultAgentId ?? agents[0]?.id;
}

async function loadAvailableProjectsWithSemanticSummaries() {
  const baseProjects = loadAvailableProjects();
  return Promise.all(baseProjects.map((project) => enrichProjectSummary(project)));
}

async function enrichProjectSummary(project: ProjectSummary): Promise<ProjectSummary> {
  const projectWorkspaces = resolveProjectWorkspaces(project, loadAvailableWorkspaces());
  const cacheKey = [
    project.id,
    project.summary ?? "",
    projectWorkspaces
      .map((workspace) => `${workspace.id}:${workspace.path}:${workspace.summary ?? ""}`)
      .join("|"),
  ].join("::");
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

function resolveProjectWorkspaces(
  project: ProjectSummary,
  availableWorkspaces: WorkspaceSummary[],
) {
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
    ? (normalized
        .split(generatedPrefix)
        .map((part) => part.trim())
        .filter(Boolean)[0] ?? normalized.replaceAll(generatedPrefix, "").trim())
    : normalized;
  const compact = withoutGeneratedPrefix || normalized;
  return compact.length > 900 ? `${compact.slice(0, 900)}…` : compact;
}

async function collectProjectSummarySource(
  project: ProjectSummary,
  projectWorkspaces: WorkspaceSummary[],
) {
  const configuredSummary = sanitizeConfiguredProjectSummary(project.name, project.summary);
  const snippets = await Promise.all(
    projectWorkspaces.slice(0, 3).map(async (workspace) => {
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
      ]
        .filter(Boolean)
        .join("\n");
    }),
  );

  return [
    `Project: ${project.name}`,
    configuredSummary ? `Configured summary: ${configuredSummary}` : "",
    ...snippets,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 9000);
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

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
  const asset = await loadStaticAsset(DECK_STATIC_DIR, request.url ?? "/");
  if (!asset.ok) {
    response.writeHead(asset.statusCode, { "content-type": "text/plain; charset=utf-8" });
    response.end(
      asset.statusCode === 404
        ? "Tiller Deck assets not found. Run pnpm --filter @tiller/helm build."
        : "Forbidden",
    );
    return;
  }

  try {
    response.writeHead(200, {
      "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "content-type": asset.contentType,
    });
    response.end(asset.body);
  } catch (error) {
    logError(
      `[tiller] failed to serve Deck asset: ${error instanceof Error ? error.message : String(error)}`,
    );
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Failed to serve Tiller Deck asset.");
  }
}

function resolveDisplayUrls() {
  const hosts = isWildcardHost(HOST) ? ["127.0.0.1", ...resolveLanAddresses()] : [HOST];
  return hosts.map((host) => `http://${host}:${PORT}`);
}

function resolvePrimaryDisplayHost() {
  return isWildcardHost(HOST) ? (resolveLanAddresses()[0] ?? "127.0.0.1") : HOST;
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
    prompt: (text: string, content?: AgentPromptContent[]) => void;
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
