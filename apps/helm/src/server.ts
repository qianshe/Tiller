import { WebSocket, WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { createServer } from "node:http";
import {
  ensureTillerConfigDefaults,
  getDefaultConfigPath,
  listAvailableProviders,
  loadTillerConfigStub,
  readApprovalPolicy,
  readTillerConfig,
  resolveHelmById,
  resolveProjectById,
  resolveProviderById,
  saveApprovalPolicyRule,
  saveHelmToConfig,
  saveProviderToConfig,
  saveWorktreeToConfig,
} from "@tiller/agent-registry";
import {
  connectAcpConnection,
  createAcpRuntime,
  disposeAcpConnections,
  listAcpConnectionInventory,
  reconnectAcpConnection,
  testAcpConnection,
} from "@tiller/acp-runtime";
import {
  isWildcardHost,
  type AcpAgentProvider,
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
  type WorktreeSummary,
} from "@tiller/shared";
import {
  applyAgentMessageToSummary,
  applyUserPromptToSummary,
  resolveSessionCleanupOutcome,
} from "./sessions/facade";
import { createHelmServerStores } from "./app/server-composition";
import { createHelmServerEnvironment } from "./app/server-environment";
import { createHelmContextState } from "./app/server-context";
import { createHelmRuntimeComposition } from "./app/runtime-composition";
import { attachHelmRpcConnection } from "./app/transport-composition";
import { createStaticDeckHandler } from "./app/static-deck-handler";
import { createHelmAuthComposition } from "./app/auth-composition";
import { createHandlerCatalogContext } from "./app/handler-catalog-context";
import { createHandlerNotificationContext } from "./app/handler-notification-context";
import { createHandlerSessionContextFactory } from "./app/handler-session-context";
import { broadcastPromptTrace } from "./rpc/notifications";
import type { HelmHandlerContext } from "./handlers/context";
import { assertHelmPortAvailable, resolveLanAddresses } from "./runtime/port-availability";
import { resolveTillerRuntimeOptions } from "./runtime/options";
import { createProjectCatalog } from "./runtime/project-catalog";
import { createLiveMessageBuffer } from "./runtime/live-message-buffer";
import { createPromptTraceEmitter } from "./runtime/prompt-trace";
import { drainPromptQueue } from "./runtime/session-router";
import { createSessionTopicRegistry } from "./runtime/session-topics";
import { resolveDeckStaticDir } from "./runtime/static-assets";
import { installWebSocketHeartbeat } from "./runtime/websocket-heartbeat";
import { createTillerLogger } from "./logging/logger";
import { createSocketState } from "./state/socket";
import { TILLER_VERSION } from "./cli";
import {
  buildUpdateNotice,
  formatStartupUpdateNotice,
  loadUpdateVersions,
  resolveUpdateOptions,
} from "./updates/check.js";

// Tiller verification ping by Antigravity 🐾
const configPath = getDefaultConfigPath();
const serverEnvironment = createHelmServerEnvironment(configPath);
ensureTillerConfigDefaults(configPath);
const configStub = loadTillerConfigStub(configPath);
const tillerConfig = readTillerConfig(configPath);
const {
  host: HOST,
  port: PORT,
  authMode: AUTH_MODE,
} = resolveTillerRuntimeOptions({ config: tillerConfig });
const DEFAULT_WORKSPACE_ROOT = process.cwd();
const LOGS_DIR = serverEnvironment.logsDir;
const DECK_STATIC_DIR = resolveDeckStaticDir(import.meta.url);
const PROMPT_TRACE_ENABLED = process.env.TILLER_PROMPT_TRACE === "1";

const logger = createTillerLogger({ logsDir: LOGS_DIR });
const { logInfo, logDebug, logWarn, logError } = logger;
const TILLER_LOG_FILE = logger.logFile;

const {
  sessionStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionRuntimeStore,
  trustedDeviceStore,
} = createHelmServerStores({
  environment: serverEnvironment,
  logInfo,
  logError,
});
const projectCatalog = createProjectCatalog({
  configPath,
  host: HOST,
  port: PORT,
  defaultWorktreeRoot: DEFAULT_WORKSPACE_ROOT,
});
const {
  loadAvailableHelms,
  loadAvailableProjects,
  loadAvailableProjectsWithSemanticSummaries,
  loadAvailableWorktrees,
} = projectCatalog;
const socketState = createSocketState<WebSocket>();
const { registry: authenticatedSockets, getSocketId } = socketState;
const sessionTopics = createSessionTopicRegistry();
const handlerNotificationContext = createHandlerNotificationContext({
  authenticatedSockets,
  sessionTopics,
});
const { broadcastNotification } = handlerNotificationContext;
const liveMessageBuffer = createLiveMessageBuffer();
const contextState = createHelmContextState({
  helms: loadAvailableHelms(),
  worktrees: loadAvailableWorktrees(),
  agents: listAvailableProviders(configPath),
  projects: loadAvailableProjects(),
});
const handlerCatalogContext = createHandlerCatalogContext({
  configPath,
  contextState,
  loadAvailableHelms,
  loadAvailableWorktrees,
  listAvailableProviders,
  loadAvailableProjectsWithSemanticSummaries,
  readApprovalPolicy,
  saveApprovalPolicyRule,
});
const runtimeComposition = createHelmRuntimeComposition({
  sessionStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionRuntimeStore,
  getAgents: contextState.getAgents,
  getProjects: contextState.getProjects,
  getWorktrees: contextState.getWorktrees,
  createHandlerContext,
  broadcastNotification,
  logInfo,
  logError,
});
const { sessions, permissionIndex, promptQueue, sessionServices } = runtimeComposition;
const {
  buildResumeInfo,
  clearPermissionRequestsForSession,
  deleteLocalSessionData,
  handleRuntimeEvent,
  hydrateDiffsFromWorktreeGit,
  hydrateSessionSummary,
  migrateStoredSessionSummary,
  configureRuntimeDraft,
  createRuntimeDraft,
  discardRuntimeDraft,
  discardRuntimeDraftsForDeckClient,
  persistRuntimeDescriptor,
  persistSessionMessage,
  publishDiffUpdate,
  reimportSessionHistory,
  refreshAuthoritativeSessionHistory,
  scheduleDeckClientDraftDiscard,
  startSessionResume,
  takeRuntimeDraft,
  updateSessionSummary,
} = sessionServices;
const handlerSessionContextFactory = createHandlerSessionContextFactory({
  sessions,
  permissionIndex,
  sessionStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionRuntimeStore,
  liveMessageBuffer,
  promptQueue,
  createHandlerContext,
  drainPromptQueue,
  createRuntime: createAcpRuntime,
  connectAcpConnection,
  reconnectAcpConnection,
  listAcpConnectionInventory,
  createRuntimeDraft,
  discardRuntimeDraft,
  discardRuntimeDraftsForDeckClient,
  scheduleDeckClientDraftDiscard,
  takeRuntimeDraft,
  configureRuntimeDraft,
  testAcpConnection,
  resolveHelmById,
  resolveProjectById,
  resolveProviderById,
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
  reimportSessionHistory,
  hydrateDiffsFromWorktreeGit,
  clearPermissionRequestsForSession,
  deleteLocalSessionData,
});

// --- Device pairing state ---
const authComposition = createHelmAuthComposition({
  authMode: AUTH_MODE,
  authenticatedSockets,
  getSocketId,
  trustedDeviceStore,
  showPairingCode,
  attachRpcConnection,
  logInfo,
  logError,
});
const { pairingState, beginAuthenticationFlow } = authComposition;

function showPairingCode() {
  const code = pairingState.ensureCode();
  const pairUrl = `http://${resolvePrimaryDisplayHost()}:${PORT}?pair=${code}`;
  console.log(`[tiller] Pairing code: ${code}`);
  console.log("[tiller] Scan QR code or enter pairing code to connect:");
  qrcode.generate(pairUrl, { small: true }, (qr: string) => {
    console.log(qr);
  });
}

const handleHttpRequest = createStaticDeckHandler({
  deckStaticDir: DECK_STATIC_DIR,
  logError,
});


async function checkForTillerUpdatesOnStart() {
  const options = resolveUpdateOptions({ env: process.env, config: tillerConfig });
  if (!options.checkOnStart) {
    return;
  }

  try {
    const notice = buildUpdateNotice(await loadUpdateVersions(TILLER_VERSION), options);
    for (const line of formatStartupUpdateNotice(notice)) {
      logWarn(line);
    }
  } catch (error) {
    logWarn(
      `[tiller] update check skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
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
const stopWebSocketHeartbeat = installWebSocketHeartbeat(server);

server.on("connection", (socket) => {
  logInfo("[tiller] client connected");

  socket.on("close", () => {
    const socketId = getSocketId(socket);
    logInfo("[tiller] client disconnected");
    sessionTopics.removeSocket(socketId);
    authenticatedSockets.remove(socketId);
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
  void checkForTillerUpdatesOnStart();
});

httpServer.on("error", (error) => {
  logError(`[tiller] server error: ${error.message}`);
});

server.on("error", (error) => {
  logError(`[tiller] websocket error: ${error.message}`);
});

let shutdownStarted = false;

async function shutdownHelm(reason: NodeJS.Signals | "rpc") {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  logInfo(`[tiller] shutdown reason=${reason}; closing ACP connections`);
  stopWebSocketHeartbeat();
  server.close();
  httpServer.close();
  await disposeAcpConnections();
  logInfo(`[tiller] shutdown complete reason=${reason}`);
  process.exit(0);
}

process.once("SIGINT", (signal) => {
  void shutdownHelm(signal);
});

process.once("SIGTERM", (signal) => {
  void shutdownHelm(signal);
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
  attachHelmRpcConnection({
    socket,
    getSocketId,
    createHandlerContext,
    logError,
  });
}

function createHandlerContext(socketId?: string): HelmHandlerContext {
  return {
    configPath,
    socketId,
    ...handlerNotificationContext,
    promptTrace: createPromptTraceEmitter({
      enabled: PROMPT_TRACE_ENABLED,
      publish: (event) => broadcastPromptTrace({ broadcastNotification }, event),
    }),
    logInfo,
    logDebug,
    logWarn,
    logError,
    requestShutdown: (reason) => {
      setTimeout(() => {
        void shutdownHelm(reason);
      }, 0);
    },
    ...handlerCatalogContext,
    trustedDeviceStore,
    authenticatedSockets,
    toTrustedDeviceSummary,
    ...handlerSessionContextFactory.forSocket(socketId),
  };
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

function resolveDisplayUrls() {
  const hosts = isWildcardHost(HOST) ? ["127.0.0.1", ...resolveLanAddresses()] : [HOST];
  return hosts.map((host) => `http://${host}:${PORT}`);
}

function resolvePrimaryDisplayHost() {
  return isWildcardHost(HOST) ? (resolveLanAddresses()[0] ?? "127.0.0.1") : HOST;
}
