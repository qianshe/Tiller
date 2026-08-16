import { WebSocket, WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { createHelmServerStores } from "./app/server/composition";
import { createHelmServerEnvironment } from "./app/server/environment";
import { createHelmContextState } from "./app/server/context";
import { createHelmRuntimeComposition } from "./app/runtime-composition";
import {
  attachHelmRpcConnection,
  createHelmOutboundConnectionRegistry,
} from "./app/transport-composition";
import { createStaticDeckHandler } from "./app/static-deck-handler";
import { createHelmAuthComposition } from "./app/auth-composition";
import { createHandlerCatalogContext } from "./app/handler-context/catalog";
import { createHandlerNotificationContext } from "./app/handler-context/notification";
import { createHandlerSessionContextFactory } from "./app/handler-context/session";
import { broadcastPromptTrace } from "./rpc/notifications";
import type { HelmHandlerContext } from "./handlers/context";
import { assertHelmPortAvailable, resolveLanAddresses } from "./runtime/port-availability";
import { resolveTillerRuntimeOptions } from "./runtime/options";
import { createProjectCatalog } from "./runtime/project/catalog";
import { createLiveMessageBuffer } from "./runtime/live-message-buffer";
import { createPromptTraceEmitter } from "./runtime/prompt-trace";
import { drainPromptQueue, markSessionStalled } from "./runtime/session/router";
import { createSessionTopicRegistry } from "./runtime/session/topics";
import { resolveDeckStaticDir } from "./runtime/static-assets";
import { installWebSocketHeartbeat } from "./runtime/websocket-heartbeat";
import { startStalledSessionWatchdog } from "./runtime/session/stalled-watchdog";
import { createTillerLogger } from "./logging/logger";
import { createRuntimeMetrics } from "./logging/runtime-metrics";
import { resolveLoggingOptions } from "./logging/options";
import { createSocketState } from "./state/socket";
import { TILLER_VERSION } from "./cli";
import {
  buildUpdateNotice,
  loadUpdateVersions,
  LATEST_UPDATE_COMMAND,
  PREVIEW_UPDATE_COMMAND,
  resolveUpdateOptions,
} from "./updates/check.js";
import { isPublishedRuntime, isSameOriginConnection } from "./updates/runtime-policy.js";
import { createUpdateService } from "./updates/service.js";

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

const loggingOptions = resolveLoggingOptions(process.env, tillerConfig.logging);
const ACP_LOGS_DIR = resolve(LOGS_DIR, "acp");
const acpProtocolLogging = {
  mode: loggingOptions.acpTrace,
  logsDir: ACP_LOGS_DIR,
};
const logger = createTillerLogger({
  logsDir: LOGS_DIR,
  level: loggingOptions.level,
  format: loggingOptions.format,
  consoleOutput: loggingOptions.format === "pretty",
});
const { logInfo, logDebug, logWarn, logError } = logger;
const runtimeMetrics = createRuntimeMetrics({ logger });
const TILLER_LOG_FILE = logger.logFile;
const IS_PUBLISHED_RUNTIME = isPublishedRuntime(import.meta.url, TILLER_VERSION);

const {
  notificationStore,
  sessionStore,
  conversationPreparationStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionLegacyEvidenceStore,
  sessionAttachmentStore,
  sessionDiffBodyStore,
  sessionOutputBodyStore,
  sessionRuntimeStore,
  sessionPlanStore,
  sessionTimelineStore,
  sessionUpdateStore,
  sessionStateStore,
  sessionApprovalStore,
  sessionSubagentDetailStore,
  trustedDeviceStore,
} = createHelmServerStores({
  environment: serverEnvironment,
  logDebug,
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
const outboundConnections = createHelmOutboundConnectionRegistry();
const handlerNotificationContext = createHandlerNotificationContext({
  authenticatedSockets,
  getSocketId,
  outboundConnections,
  sessionTopics,
});
const { broadcastNotification } = handlerNotificationContext;
const updateService = createUpdateService({
  currentVersion: TILLER_VERSION,
  config: tillerConfig,
  env: process.env,
  host: HOST,
  port: PORT,
  isPublishedRuntime: IS_PUBLISHED_RUNTIME,
  logPath: resolve(LOGS_DIR, "update.log"),
  requestShutdown: (reason) => {
    setTimeout(() => {
      void shutdownHelm(reason);
    }, 0);
  },
  updaterLaunch: resolveUpdaterLaunch(),
  emitStatus: (status) => {
    broadcastNotification("daemon/update/status", {
      ...status,
      occurredAt: new Date().toISOString(),
    });
  },
});
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
  sessionAttachmentStore,
  sessionDiffBodyStore,
  sessionOutputBodyStore,
  sessionRuntimeStore,
  sessionPlanStore,
  sessionTimelineStore,
  sessionUpdateStore,
  sessionStateStore,
  sessionApprovalStore,
  sessionSubagentDetailStore,
  getAgents: contextState.getAgents,
  getProjects: contextState.getProjects,
  getWorktrees: contextState.getWorktrees,
  createHandlerContext,
  broadcastNotification,
  logInfo,
  logError,
  logger,
  protocolLogging: acpProtocolLogging,
});
const { sessions, permissionIndex, promptQueue, sessionServices } = runtimeComposition;
const {
  buildResumeInfo,
  clearPermissionRequestsForSession,
  deleteLocalSessionData,
  handleRuntimeEvent,
  hydrateDiffsFromWorktreeGit,
  hydrateSessionSummary,
  configureRuntimeDraft,
  createRuntimeDraft,
  discardRuntimeDraft,
  discardRuntimeDraftsForDeckClient,
  persistRuntimeDescriptor,
  persistSessionMessage,
  publishDiffUpdate,
  readSessionLiveState,
  scheduleDeckClientDraftDiscard,
  sessionLiveStateStore,
  sessionApprovalStateStore,
  sessionRuntimeEventState,
  sessionSubagentDetailService,
  sessionTimelineDispatcher,
  sessionTimelineFlushScheduler,
  sessionTimelineWorkers,
  startSessionResume,
  takeRuntimeDraft,
  updateSessionSummary,
} = sessionServices;
const handlerSessionContextFactory = createHandlerSessionContextFactory({
  sessions,
  permissionIndex,
  sessionStore,
  conversationPreparationStore,
  sessionMessageStore,
  sessionArtifactStore,
  sessionLegacyEvidenceStore,
  sessionAttachmentStore,
  sessionDiffBodyStore,
  sessionOutputBodyStore,
  sessionRuntimeStore,
  sessionPlanStore,
  sessionTimelineStore,
  sessionTimelineWorkers,
  sessionTimelineDispatcher,
  sessionTimelineFlushScheduler,
  sessionLiveStateStore,
  sessionApprovalStateStore,
  sessionRuntimeEventState,
  sessionSubagentDetailService,
  sessionUpdateStore,
  liveMessageBuffer,
  promptQueue,
  createHandlerContext,
  drainPromptQueue,
  createRuntime: (options) => createAcpRuntime({ ...options, protocolLogging: acpProtocolLogging }),
  connectAcpConnection: (options) => connectAcpConnection({ ...options, protocolLogging: acpProtocolLogging }),
  reconnectAcpConnection: (options) => reconnectAcpConnection({ ...options, protocolLogging: acpProtocolLogging }),
  listAcpConnectionInventory,
  createRuntimeDraft,
  discardRuntimeDraft,
  discardRuntimeDraftsForDeckClient,
  scheduleDeckClientDraftDiscard,
  takeRuntimeDraft,
  configureRuntimeDraft,
  testAcpConnection: (agent, cwd) => testAcpConnection(agent, cwd, acpProtocolLogging),
  resolveHelmById,
  resolveProjectById,
  resolveProviderById,
  startSessionResume,
  handleRuntimeEvent,
  hydrateSessionSummary,
  buildResumeInfo,
  persistRuntimeDescriptor,
  readSessionLiveState,
  updateSessionSummary,
  persistSessionMessage,
  publishDiffUpdate,
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
  logDebug,
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
  sessionAttachmentStore,
  sessionDiffBodyStore,
  sessionOutputBodyStore,
  logError,
});


async function checkForTillerUpdatesOnStart() {
  const options = resolveUpdateOptions({ env: process.env, config: tillerConfig });
  if (!options.checkOnStart) {
    return;
  }

  try {
    const result = await updateService.check(false, false, () => undefined);
    if (result.updateAvailable && result.latestVersion) {
      logger.warn("updates.latest_available", {
        current: result.currentVersion,
        latest: result.latestVersion,
        command: LATEST_UPDATE_COMMAND,
      });
    }
    const notice = buildUpdateNotice(
      await loadUpdateVersions(TILLER_VERSION),
      options,
    );
    if (notice.kind === "preview-hint") {
      logger.warn("updates.preview_available", {
        current: notice.current,
        preview: notice.preview,
        command: PREVIEW_UPDATE_COMMAND,
      });
    }
  } catch (error) {
    logger.warn("updates.check_skipped", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

try {
  await assertHelmPortAvailable({ host: HOST, port: PORT });
} catch (error) {
  logger.error("server.startup_blocked", {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

const httpServer = createServer(handleHttpRequest);
const server = new WebSocketServer({
  server: httpServer,
  // Git diff/patch 等文本载荷压缩率高;仅压缩 >1KB 的消息,
  // 本地少客户端场景下 zlib 上下文的内存开销可以忽略。
  perMessageDeflate: { threshold: 1024 },
});
const sameOriginConnections = new WeakMap<WebSocket, boolean>();
const stopWebSocketHeartbeat = installWebSocketHeartbeat(server);
// ACP 连接可能在崩溃、被替换或进程被杀后消失,依附其上的会话再也收不到运行时
// 事件,会永远停在 running/waiting。周期性把这些失联会话推进到 error 终态。
const stopStalledSessionWatchdog = startStalledSessionWatchdog({
  listSessionSummaries: () => sessionStore.list(),
  hasRuntimeRecord: (sessionId) => sessions.has(sessionId),
  listConnections: () => listAcpConnectionInventory(),
  markStalled: (session) => {
    logger.warn("session.stalled.reclaimed", {
      sessionId: session.id,
      previousStatus: session.status,
    });
    markSessionStalled(
      session.id,
      "ACP runtime is no longer reachable for this session.",
      createHandlerContext(),
    );
  },
  logError,
});

server.on("connection", (socket, request) => {
  sameOriginConnections.set(
    socket,
    isSameOriginConnection(
      typeof request.headers.origin === "string" ? request.headers.origin : undefined,
      request.headers.host,
    ),
  );
  logger.debug("websocket.client.connected");

  socket.on("close", () => {
    const socketId = getSocketId(socket);
    logger.debug("websocket.client.disconnected", { socketId });
    handlerNotificationContext.removeSocketSessionTopics(socketId);
    authenticatedSockets.remove(socketId);
    sameOriginConnections.delete(socket);
  });

  beginAuthenticationFlow(socket);
});

httpServer.listen(PORT, HOST);

httpServer.on("listening", () => {
  logger.info("server.listening", { host: HOST, port: PORT, url: `http://${HOST}:${PORT}` });
  for (const url of resolveDisplayUrls()) {
    logger.info("server.deck_available", { url });
  }
  logger.debug("server.websocket_available", { origin: "same-origin" });
  logger.debug("server.auth_mode", { authMode: AUTH_MODE });
  logger.debug("server.config_stub", {
    exists: configStub.exists,
    path: configStub.configPath,
  });
  logger.info("server.logs_file", { path: TILLER_LOG_FILE });
  void checkForTillerUpdatesOnStart();
});

httpServer.on("error", (error) => {
  logger.error("server.http_error", { message: error.message });
});

server.on("error", (error) => {
  logger.error("server.websocket_error", { message: error.message });
});

let shutdownStarted = false;

async function shutdownHelm(reason: NodeJS.Signals | "rpc") {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  logger.info("server.shutdown.started", { reason });
  stopWebSocketHeartbeat();
  stopStalledSessionWatchdog();
  server.close();
  httpServer.close();
  await disposeAcpConnections();
  sessionServices.dispose();
  logger.info("server.shutdown.completed", { reason });
  runtimeMetrics.dispose();
  await logger.close();
  process.exit(0);
}

process.once("SIGINT", (signal) => {
  void shutdownHelm(signal);
});

process.once("SIGTERM", (signal) => {
  void shutdownHelm(signal);
});

process.on("warning", (warning) => {
  logger.warn("process.warning", {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", {
    message: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", reason instanceof Error
    ? { message: reason.message, stack: reason.stack }
    : { reason: String(reason) });
});

function attachRpcConnection(socket: WebSocket) {
  attachHelmRpcConnection({
    socket,
    getSocketId,
    outboundConnections,
    createHandlerContext,
    logInfo,
    logError,
    runtimeMetrics,
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
    logger,
    runtimeMetrics,
    requestShutdown: (reason) => {
      setTimeout(() => {
        void shutdownHelm(reason);
      }, 0);
    },
    updateService,
    isLocalConnection: () => {
      const socket = socketId
        ? authenticatedSockets.listAll().find((record) => record.socketId === socketId)?.socket
        : undefined;
      return socket ? sameOriginConnections.get(socket) === true : false;
    },
    ...handlerCatalogContext,
    trustedDeviceStore,
    notificationStore,
    authenticatedSockets,
    toTrustedDeviceSummary,
    ...handlerSessionContextFactory.forSocket(socketId),
  };
}

function resolveUpdaterLaunch() {
  if (!IS_PUBLISHED_RUNTIME) return undefined;
  const entryPath = fileURLToPath(import.meta.url);
  return {
    updaterPath: resolve(entryPath, "../updater.js"),
    nodeExecutable: process.execPath,
    helmEntryPath: entryPath,
    helmArgs: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    parentPid: process.pid,
    host: HOST,
    port: PORT,
    logPath: resolve(LOGS_DIR, "update.log"),
    interactive: Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY),
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
