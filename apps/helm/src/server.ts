import { WebSocket, WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import {
  ensureTillerConfigDefaults,
  getDefaultConfigPath,
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
import { createAcpRuntime, reconnectAcpConnection, testAcpConnection, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import { JsonRpcConnection, encodeMessage } from "@tiller/sync-protocol";
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
import {
  applyAgentMessageToSummary,
  applyUserPromptToSummary,
  createHelmSessionStores,
  resolveSessionCleanupOutcome,
  resolveSessionStoreBackend,
} from "./sessions/facade";
import { createTrustedDeviceStore } from "./auth/beacon-store";
import { createSocketAuthenticator } from "./auth/socket-auth";
import { createWebSocketJsonRpcStream } from "./rpc/websocket-stream";
import { handleHelmRpcNotification, handleHelmRpcRequest } from "./rpc/router";
import type { HelmHandlerContext } from "./handlers/context";
import { assertHelmPortAvailable, resolveLanAddresses } from "./runtime/port-availability";
import { resolveTillerRuntimeOptions } from "./runtime/options";
import { createProjectCatalog } from "./runtime/project-catalog";
import { createSessionServices, type SessionRecord } from "./runtime/session-services";
import { loadStaticAsset, resolveDeckStaticDir } from "./runtime/static-assets";
import { createTillerLogger } from "./logging/logger";
import { createPairingState } from "./state/pairing";
import { createSocketState } from "./state/socket";

// Tiller verification ping by Antigravity 🐾
const configPath = getDefaultConfigPath();
ensureTillerConfigDefaults(configPath);
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
const projectCatalog = createProjectCatalog({
  configPath,
  host: HOST,
  port: PORT,
  defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
});
const {
  loadAvailableHelms,
  loadAvailableProjects,
  loadAvailableProjectsWithSemanticSummaries,
  loadAvailableWorkspaces,
  resolveDefaultProjectAgentId,
} = projectCatalog;
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
const sessionServices = createSessionServices({
  sessions,
  permissionIndex,
  sessionStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionRuntimeStore,
  getAgents: () => agents,
  getProjects: () => projects,
  getWorkspaces: () => workspaces,
  createHandlerContext,
  broadcastNotification,
  logInfo,
  logError,
});
const {
  buildResumeInfo,
  clearPermissionRequestsForSession,
  deleteLocalSessionData,
  handleRuntimeEvent,
  hydrateDiffsFromWorkspaceGit,
  hydrateSessionSummary,
  migrateStoredSessionSummary,
  persistRuntimeDescriptor,
  persistSessionMessage,
  prewarmRuntime,
  publishDiffUpdate,
  refreshAuthoritativeSessionHistory,
  startSessionResume,
  takePrewarmedRuntime,
  updateSessionSummary,
} = sessionServices;

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
  attachRpcConnection,
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

function attachRpcConnection(socket: WebSocket) {
  const stream = createWebSocketJsonRpcStream(socket, (error) => {
    logError(`[tiller] json-rpc decode failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  const connection = new JsonRpcConnection(stream, {
    onRequest: (method, params) => handleHelmRpcRequest(method, params, createHandlerContext()),
    onNotification: (method, params) => handleHelmRpcNotification(method, params, createHandlerContext()),
    onError: (error) => {
      logError(`[tiller] json-rpc handler failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  socket.once("close", () => {
    connection.close();
  });
}

function createHandlerContext(): HelmHandlerContext {
  return {
    configPath,
    notify,
    broadcastNotification,
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
    reconnectAcpConnection,
    prewarmRuntime,
    takePrewarmedRuntime,
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

function notify(socket: WebSocket, method: string, params: unknown) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(encodeMessage({ jsonrpc: "2.0", method, params }));
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


function broadcastNotification(method: string, params: unknown) {
  for (const record of authenticatedSockets.listAll()) {
    notify(record.socket, method, params);
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
