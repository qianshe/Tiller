import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLaunchSpec, terminateChildProcess } from "./process";
import { resolveAcpLaunchConfig, resolveAdapterCapabilities } from "./adapters";
import { extractAcpModelState, extractSessionConfigOptions, findSessionConfigOptionId, hasSessionConfigOptionValue, mapSessionUpdateNotification, resolveCombinedSessionConfigState, resolveSessionConfigState } from "./events";
import { resolveRuntimeSessionId } from "./requests";
import { SDK_PROBE_CLIENT_CAPABILITIES, SDK_RUNTIME_CLIENT_CAPABILITIES, mapPromptContentToSdkBlocks, mapSdkPermissionRequest, mapTillerMcpServersToSdkMcpServers } from "./sdk-helpers";
import {
  ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
  ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
} from "@tiller/shared";
import type {
  AcpAgentProvider,
  AcpAgentSessionInfo,
  AcpModelOption,
  AcpModelState,
  AgentMessage,
  AgentPromptContent,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionReasoningEffort,
  SessionStatus,
  WorkspaceSummary,
} from "@tiller/shared";

export const DEFAULT_ACP_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_ACP_PROMPT_TIMEOUT_MS = 30 * 60_000;
const ACP_INITIALIZE_TIMEOUT_MS = DEFAULT_ACP_REQUEST_TIMEOUT_MS;
const ACP_EARLY_STDERR_FAILURE = /failed to start server|eaddrinuse|address already in use/i;

export type ProviderCleanupResult =
  | { kind: "unsupported"; providerId: string; message: string }
  | { kind: "remote-deleted"; providerId: string; message: string }
  | { kind: "remote-delete-failed"; providerId: string; message: string }
  | { kind: "remote-closed"; providerId: string; message: string }
  | { kind: "remote-close-failed"; providerId: string; message: string };
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOGS_DIR = resolve(REPO_ROOT, "logs");
const ACP_LOGS_DIR = resolve(LOGS_DIR, "acp");

mkdirSync(ACP_LOGS_DIR, { recursive: true });

export type SessionRuntimeEvent =
  | {
      type: "status";
      status: SessionStatus;
      message?: string;
    }
  | {
      type: "message";
      message: AgentMessage;
    }
  | {
      type: "permission-request";
      request: PermissionRequest;
    }
  | {
      type: "tool-call";
      toolCall: AgentToolCall;
    }
  | {
      type: "command-output";
      chunk: CommandChunk;
      toolCall?: AgentToolCall;
    }
  | {
      type: "diff-update";
      files: FileDiffSummary[];
    }
  | {
      type: "config-options";
      state: AcpSessionConfigState;
      options: AcpSessionConfigOption[];
    }
  | {
      type: "model-options";
      state: AcpModelState;
    }
  | {
      type: "available-commands";
      commands: AvailableCommand[];
    }
  | {
      type: "error";
      message: string;
      code?: string;
    };

export type AcpSessionRestoreStrategy = "load" | "resume";

export type AcpRuntimeOptions = {
  sessionId: string;
  workspace: WorkspaceSummary;
  agent: AcpAgentProvider;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
  restore?: {
    runtimeSessionId: string;
    strategy: AcpSessionRestoreStrategy;
  };
  onEvent: (event: SessionRuntimeEvent) => void;
};

export type DetectedAcpSessionCapabilities = {
  sessionLoad?: boolean;
  sessionResume?: boolean;
  sessionList?: boolean;
  sessionClose?: boolean;
  sessionDelete?: boolean;
  imageInput?: boolean;
};

export type AcpAgentSessionListResult = {
  sessions: AcpAgentSessionInfo[];
  nextCursor?: string;
  meta?: unknown;
};

export function normalizeAcpAgentSessionListResult(result: any): AcpAgentSessionListResult {
  const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
  return {
    sessions: sessions.map((item: any) => ({
      sessionId: String(item?.sessionId ?? item?.session_id ?? item?.id ?? ""),
      cwd: typeof item?.cwd === "string" ? item.cwd : undefined,
      title: typeof item?.title === "string" ? item.title : undefined,
      updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : typeof item?.updated_at === "string" ? item.updated_at : undefined,
      meta: item?.meta,
    })).filter((item: AcpAgentSessionInfo) => item.sessionId.length > 0),
    nextCursor: typeof result?.nextCursor === "string" ? result.nextCursor : typeof result?.next_cursor === "string" ? result.next_cursor : undefined,
    meta: result?.meta,
  };
}

export type AcpSessionConfigOptionValue = string | boolean;

export type AcpSessionConfigOption = {
  id: string;
  name?: string;
  category?: string;
  currentValue?: AcpSessionConfigOptionValue;
  selectedValue?: AcpSessionConfigOptionValue;
  value?: AcpSessionConfigOptionValue;
  options?: Array<{ value: AcpSessionConfigOptionValue; label?: string; name?: string }>;
};

export type AcpSessionConfigState = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

type AcpProtocolModelInfo = {
  modelId?: string;
  model_id?: string;
  id?: string;
  name?: string;
  description?: string | null;
};

type AcpProtocolSessionModelState = {
  currentModelId?: string;
  current_model_id?: string;
  availableModels?: AcpProtocolModelInfo[];
  available_models?: AcpProtocolModelInfo[];
};

type AcpSessionResponseWithModels = {
  sessionId?: string;
  session_id?: string;
  id?: string;
  models?: AcpProtocolSessionModelState | null;
};

export async function testAcpConnection(provider: AcpAgentProvider, cwd = process.cwd()) {
  const launchConfig = resolveAcpLaunchConfig(provider, { fallbackCwd: cwd });
  const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
  const launchCwd = launchConfig.cwd;
  const childEnv = { ...process.env, ...launchConfig.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const initializeTimeoutMs = provider.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS;
  const logFile = resolve(ACP_LOGS_DIR, `connection-test-${sanitizeLogToken(provider.id)}.log`);

  writeLogLine(
    logFile,
    "meta",
    `Starting ACP SDK connection test command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  const processClosed = new Promise<never>((_resolve, reject) => {
    child.once("error", (error) => {
      writeLogLine(logFile, "process-error", error.message);
      reject(new Error(`Failed to start ACP command: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      const message = `ACP SDK connection test exited code=${code ?? "unknown"} signal=${signal ?? "unknown"}`;
      writeLogLine(logFile, "exit", message);
      reject(new Error(stderrBuffer.trim() ? `${message}: ${stderrBuffer.trim()}` : message));
    });
  });
  processClosed.catch(() => {});

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
  });

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const agent = new acp.ClientSideConnection(() => ({
    async sessionUpdate() {
      return undefined;
    },
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } } satisfies acp.RequestPermissionResponse;
    },
    async readTextFile() {
      throw acp.RequestError.methodNotFound("fs/read_text_file");
    },
    async writeTextFile() {
      throw acp.RequestError.methodNotFound("fs/write_text_file");
    },
  }), stream);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(stderrBuffer.trim() || "Timed out waiting for ACP initialize response."));
    }, initializeTimeoutMs);
  });

  try {
    writeLogLine(logFile, "sdk-request", "initialize");
    const initializeResult = await Promise.race([
      agent.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: SDK_PROBE_CLIENT_CAPABILITIES,
        clientInfo: { name: "tiller", version: "0.1.0" },
      }),
      timeout,
      processClosed,
    ]);
    const agentName = initializeResult.agentInfo?.name ?? provider.name;
    const version = initializeResult.agentInfo?.version ? ` v${initializeResult.agentInfo.version}` : "";
    return { ok: true, message: `ACP initialize passed for ${agentName}${version}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to initialize ACP agent.",
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    terminateChildProcess(child.pid);
  }
}

export async function listAcpAgentSessions(provider: AcpAgentProvider, workspace: WorkspaceSummary, cursor?: string): Promise<AcpAgentSessionListResult> {
  const launchConfig = resolveAcpLaunchConfig(provider, { fallbackCwd: workspace.path });
  const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
  const launchCwd = launchConfig.cwd;
  const childEnv = { ...process.env, ...launchConfig.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const logFile = resolve(ACP_LOGS_DIR, `session-list-${sanitizeLogToken(provider.id)}.log`);

  writeLogLine(
    logFile,
    "meta",
    `Starting ACP SDK session list command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  let exitError: Error | null = null;

  const exited = new Promise<never>((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      const message = `ACP SDK session list process exited code=${code ?? "unknown"} signal=${signal ?? "unknown"}`;
      exitError = new Error(stderrBuffer.trim() ? `${message}: ${stderrBuffer.trim()}` : message);
      writeLogLine(logFile, "exit", message);
      reject(exitError);
    });
  });
  exited.catch(() => {});

  child.on("error", (error) => {
    writeLogLine(logFile, "process-error", error.message);
    exitError = error;
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
  });

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const agent = new acp.ClientSideConnection(() => ({
    async sessionUpdate() {
      return undefined;
    },
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } } satisfies acp.RequestPermissionResponse;
    },
    async readTextFile() {
      throw acp.RequestError.methodNotFound("fs/read_text_file");
    },
    async writeTextFile() {
      throw acp.RequestError.methodNotFound("fs/write_text_file");
    },
  }), stream);

  const withSdkRequest = async <T>(method: string, operation: Promise<T>, timeoutMs = provider.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS): Promise<T> => {
    if (exitError) {
      throw exitError;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(stderrBuffer.trim() || `Timed out waiting for ACP response: ${method}`));
      }, timeoutMs);
    });
    try {
      writeLogLine(logFile, "sdk-request", method);
      return await Promise.race([operation, timeoutPromise, exited]);
    } catch (error) {
      if (stderrBuffer.trim() && error instanceof Error && /ACP connection closed/iu.test(error.message)) {
        throw new Error(`${error.message}: ${stderrBuffer.trim()}`);
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  try {
    const initializeResult = await withSdkRequest("initialize", agent.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: SDK_PROBE_CLIENT_CAPABILITIES,
      clientInfo: { name: "tiller", version: "0.1.0" },
    }));
    const sessionCapabilities = resolveSessionCapabilities(initializeResult, provider);
    if (!sessionCapabilities.sessionList) {
      throw new Error("ACP agent does not advertise session/list capability.");
    }
    const result = await withSdkRequest(
      "session/list",
      agent.listSessions({
        cwd: launchCwd,
        ...(cursor ? { cursor } : {}),
      }),
      15_000,
    );
    return normalizeAcpAgentSessionListResult(result);
  } finally {
    terminateChildProcess(child.pid);
  }
}

export async function createAcpRuntime(options: AcpRuntimeOptions) {
  const launchConfig = resolveAcpLaunchConfig(options.agent, { fallbackCwd: options.workspace.path, sessionConfig: options.sessionConfig });
  const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
  const launchCwd = launchConfig.cwd;
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...launchConfig.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const logFile = resolve(ACP_LOGS_DIR, `session-${sanitizeLogToken(options.sessionId)}.log`);
  const mcpServers = mapTillerMcpServersToSdkMcpServers(options.agent.mcpServers ?? []);

  writeLogLine(
    logFile,
    "meta",
    `Starting ACP SDK session agent=${options.agent.id} command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrBuffer = "";
  let cancelled = false;
  let closed = false;
  let sessionToken = "";
  let currentConfigOptions: AcpSessionConfigOption[] = [];
  let currentModelState: AcpModelState | undefined;
  let permissionRequestCounter = 0;
  let terminalCounter = 0;
  let exitError: Error | null = null;
  const pendingPermissionReplies = new Map<string,
    | {
        kind: "agent";
        allowOptionId?: string;
        denyOptionId?: string;
        resolve: (response: acp.RequestPermissionResponse) => void;
      }
    | {
        kind: "client";
        resolve: (allowed: boolean) => void;
      }
  >();
  const terminals = new Map<string, ManagedSdkTerminal>();

  const failPendingPermissions = () => {
    for (const pendingPermission of pendingPermissionReplies.values()) {
      if (pendingPermission.kind === "agent") {
        pendingPermission.resolve({ outcome: { outcome: "cancelled" } });
      } else {
        pendingPermission.resolve(false);
      }
    }
    pendingPermissionReplies.clear();
  };

  const closeTerminals = () => {
    for (const terminal of terminals.values()) {
      terminateChildProcess(terminal.process.pid);
    }
    terminals.clear();
  };

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    failPendingPermissions();
    closeTerminals();
  };

  const exited = new Promise<never>((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      const message = `ACP SDK process exited code=${code ?? "unknown"} signal=${signal ?? "unknown"}`;
      exitError = new Error(stderrBuffer.trim() ? `${message}: ${stderrBuffer.trim()}` : message);
      writeLogLine(logFile, "exit", message);
      cleanup();
      if (!cancelled) {
        options.onEvent({
          type: "status",
          status: code === 0 ? "idle" : "error",
          message: code === 0 ? "ACP session closed" : `ACP process exited with code ${code ?? "unknown"}`,
        });
      }
      reject(exitError);
    });
  });
  exited.catch(() => {});

  child.on("error", (error) => {
    writeLogLine(logFile, "process-error", error.message);
    options.onEvent({ type: "error", code: "ACP_LAUNCH_FAILED", message: `Failed to start ACP command: ${error.message}` });
    cleanup();
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
    if (ACP_EARLY_STDERR_FAILURE.test(stderrBuffer)) {
      options.onEvent({ type: "error", code: "ACP_STDERR", message: stderrBuffer.trim() });
    }
  });

  const ensureActiveSessionRequest = (requestSessionId: string) => {
    if (sessionToken && requestSessionId !== sessionToken) {
      throw new Error(`ACP client request targeted unknown session ${requestSessionId}.`);
    }
  };

  const requestClientPermission = async (command: string, reason: string) => {
    permissionRequestCounter += 1;
    const id = `sdk-client-permission-${permissionRequestCounter}`;
    options.onEvent({
      type: "status",
      status: "waiting_for_permission",
      message: reason,
    });
    options.onEvent({
      type: "permission-request",
      request: {
        id,
        command,
        reason,
        workspacePath: options.workspace.path,
      },
    });
    return await new Promise<boolean>((resolve) => {
      pendingPermissionReplies.set(id, { kind: "client", resolve });
    });
  };

  const resolveWorkspacePath = (requestPath: string) => resolveContainedWorkspacePath(options.workspace.path, requestPath);

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const agent = new acp.ClientSideConnection(() => ({
    async sessionUpdate(params) {
      const mapped = mapSessionUpdateNotification({ method: "session/update", params });
      if (!mapped || (sessionToken && mapped.sessionId !== sessionToken)) {
        return;
      }
      if (mapped.event.type === "config-options") {
        currentConfigOptions = mapped.event.options;
      }
      writeProtocolLog(logFile, "stdout", { method: "session/update", params });
      options.onEvent(mapped.event);
    },
    async requestPermission(params) {
      permissionRequestCounter += 1;
      const mapped = mapSdkPermissionRequest(params, `sdk-permission-${permissionRequestCounter}`, launchCwd);
      options.onEvent({
        type: "status",
        status: "waiting_for_permission",
        message: "ACP agent requested permission",
      });
      options.onEvent({
        type: "permission-request",
        request: mapped.request,
      });
      return await new Promise<acp.RequestPermissionResponse>((resolve) => {
        pendingPermissionReplies.set(mapped.id, {
          kind: "agent",
          allowOptionId: mapped.allowOptionId,
          denyOptionId: mapped.denyOptionId,
          resolve,
        });
      });
    },
    async readTextFile(params) {
      ensureActiveSessionRequest(params.sessionId);
      const filePath = resolveWorkspacePath(params.path);
      const content = await readFile(filePath, "utf8");
      return { content: sliceTextFileContent(content, params.line, params.limit) };
    },
    async writeTextFile(params) {
      ensureActiveSessionRequest(params.sessionId);
      const filePath = resolveWorkspacePath(params.path);
      const relativePath = relative(options.workspace.path, filePath) || params.path;
      const allowed = await requestClientPermission(
        `Write file: ${relativePath}`,
        "ACP agent requested workspace file write access.",
      );
      if (!allowed) {
        throw new Error(`Denied ACP file write: ${relativePath}`);
      }
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, params.content, "utf8");
      const now = new Date().toISOString();
      options.onEvent({
        type: "tool-call",
        toolCall: {
          id: `fs-write-${Date.now()}`,
          kind: "edit",
          title: `Write file: ${relativePath}`,
          status: "completed",
          input: params.path,
          output: `${params.content.length} chars written`,
          timestamp: now,
          updatedAt: now,
        },
      });
      return {};
    },
    async createTerminal(params) {
      ensureActiveSessionRequest(params.sessionId);
      const cwd = params.cwd ? resolveWorkspacePath(params.cwd) : launchCwd;
      const commandLine = formatTerminalCommand(params.command, params.args ?? []);
      const allowed = await requestClientPermission(
        commandLine,
        "ACP agent requested terminal execution.",
      );
      if (!allowed) {
        throw new Error(`Denied ACP terminal command: ${commandLine}`);
      }

      terminalCounter += 1;
      const terminalId = `sdk-terminal-${terminalCounter}`;
      const terminalProcess = spawn(params.command, params.args ?? [], {
        cwd,
        env: mergeTerminalEnv(childEnv, params.env ?? []),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const terminal: ManagedSdkTerminal = {
        id: terminalId,
        process: terminalProcess,
        output: "",
        truncated: false,
        outputByteLimit: params.outputByteLimit ?? 64 * 1024,
        exitPromise: Promise.resolve({ exitCode: null, signal: null }),
      };
      terminal.exitPromise = new Promise((resolve) => {
        terminalProcess.once("exit", (code, signal) => {
          terminal.exitStatus = { exitCode: code, signal };
          const now = new Date().toISOString();
          options.onEvent({
            type: "tool-call",
            toolCall: {
              id: `tool-${terminalId}`,
              kind: "terminal",
              title: commandLine,
              status: code === 0 ? "completed" : "failed",
              commandId: terminalId,
              output: terminal.output,
              timestamp: now,
              updatedAt: now,
            },
          });
          resolve(terminal.exitStatus);
        });
      });
      terminals.set(terminalId, terminal);

      const startedAt = new Date().toISOString();
      options.onEvent({
        type: "tool-call",
        toolCall: {
          id: `tool-${terminalId}`,
          kind: "terminal",
          title: commandLine,
          status: "running",
          commandId: terminalId,
          input: commandLine,
          timestamp: startedAt,
          updatedAt: startedAt,
        },
      });
      terminalProcess.stdout.on("data", (chunk) => emitTerminalChunk(terminal, "stdout", String(chunk), options.onEvent));
      terminalProcess.stderr.on("data", (chunk) => emitTerminalChunk(terminal, "stderr", String(chunk), options.onEvent));
      terminalProcess.once("error", (error) => emitTerminalChunk(terminal, "stderr", error.message, options.onEvent));
      return { terminalId };
    },
    async terminalOutput(params) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      return {
        output: terminal.output,
        truncated: terminal.truncated,
        exitStatus: terminal.exitStatus,
      };
    },
    async waitForTerminalExit(params) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      return await terminal.exitPromise;
    },
    async killTerminal(params) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      terminateChildProcess(terminal.process.pid);
      return {};
    },
    async releaseTerminal(params) {
      ensureActiveSessionRequest(params.sessionId);
      const terminal = requireTerminal(terminals, params.terminalId);
      if (!terminal.exitStatus) {
        terminateChildProcess(terminal.process.pid);
      }
      terminals.delete(params.terminalId);
      return {};
    },
  }), stream);

  const withSdkRequest = async <T>(method: string, operation: Promise<T>, timeoutMs = options.agent.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS): Promise<T> => {
    if (exitError) {
      throw exitError;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(stderrBuffer.trim() || `Timed out waiting for ACP response: ${method}`));
      }, timeoutMs);
    });
    try {
      writeLogLine(logFile, "sdk-request", method);
      return await Promise.race([operation, timeoutPromise, exited]);
    } catch (error) {
      if (stderrBuffer.trim() && error instanceof Error && /ACP connection closed/iu.test(error.message)) {
        throw new Error(`${error.message}: ${stderrBuffer.trim()}`);
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  options.onEvent({ type: "status", status: "starting", message: "Launching ACP session" });

  const initializeResult = await withSdkRequest("initialize", agent.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: SDK_RUNTIME_CLIENT_CAPABILITIES,
    clientInfo: { name: "tiller", version: "0.1.0" },
  }));
  const sessionCapabilities = resolveSessionCapabilities(initializeResult, options.agent);

  if (options.restore) {
    sessionToken = options.restore.runtimeSessionId;
    if (options.restore.strategy === "load") {
      if (!sessionCapabilities.sessionLoad) {
        throw new Error("ACP agent does not advertise session/load capability.");
      }
      const loadResult = await withSdkRequest<AcpSessionResponseWithModels>(
        "session/load",
        agent.loadSession({ sessionId: options.restore.runtimeSessionId, cwd: launchCwd, mcpServers }),
      );
      sessionToken = resolveRuntimeSessionId(loadResult, options.restore.runtimeSessionId);
      currentConfigOptions = extractSessionConfigOptions(loadResult);
      currentModelState = extractAcpModelState(loadResult);
    } else {
      if (!sessionCapabilities.sessionResume) {
        throw new Error("ACP agent does not advertise session.resume capability.");
      }
      const resumeResult = await withSdkRequest<AcpSessionResponseWithModels>(
        "session/resume",
        agent.resumeSession({ sessionId: options.restore.runtimeSessionId, cwd: launchCwd, mcpServers }),
      );
      sessionToken = resolveRuntimeSessionId(resumeResult, options.restore.runtimeSessionId);
      currentConfigOptions = extractSessionConfigOptions(resumeResult);
      currentModelState = extractAcpModelState(resumeResult);
    }
  } else {
    const sessionResult = await withSdkRequest<AcpSessionResponseWithModels>(
      "session/new",
      agent.newSession({ cwd: launchCwd, mcpServers }),
    );
    sessionToken = resolveRuntimeSessionId(sessionResult, options.sessionId);
    currentConfigOptions = extractSessionConfigOptions(sessionResult);
    currentModelState = extractAcpModelState(sessionResult);
  }

  const applyConfigOption = async (
    category: "mode" | "model" | "thought_level",
    value: string | undefined,
    timeoutMs = 15_000,
  ) => {
    if (!value) {
      return false;
    }

    const optionId = findSessionConfigOptionId(currentConfigOptions, category);
    if (!optionId) {
      return false;
    }

    const result = await withSdkRequest<any>(
      "session/set_config_option",
      agent.setSessionConfigOption({ sessionId: sessionToken, configId: optionId, value }),
      timeoutMs,
    );
    const nextOptions = extractSessionConfigOptions(result);
    if (nextOptions.length) {
      currentConfigOptions = nextOptions;
    }
    return true;
  };

  if (options.sessionConfig?.agentMode && hasSessionConfigOptionValue(currentConfigOptions, "mode", options.sessionConfig.agentMode)) {
    await applyConfigOption("mode", options.sessionConfig.agentMode);
  }

  if (currentModelState?.options.length) {
    options.onEvent({
      type: "model-options",
      state: currentModelState,
    });
  }

  if (currentConfigOptions.length) {
    options.onEvent({
      type: "config-options",
      state: resolveSessionConfigState(currentConfigOptions),
      options: currentConfigOptions,
    });
  }
  options.onEvent({ type: "status", status: "idle", message: "ACP session ready" });

  const prompt = async (text: string, content?: AgentPromptContent[]) => {
    const promptContent = content?.length ? content : [{ type: "text" as const, text }];
    const hasImages = promptContent.some((item) => item.type === "image");
    if (hasImages && !sessionCapabilities.imageInput) {
      options.onEvent({
        type: "error",
        code: ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
        message: ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
      });
      options.onEvent({ type: "status", status: "error", message: "ACP 不支持图片输入" });
      return;
    }

    options.onEvent({ type: "status", status: "running", message: "ACP agent is responding" });
    try {
      await withSdkRequest(
        "session/prompt",
        agent.prompt({ sessionId: sessionToken, prompt: mapPromptContentToSdkBlocks(promptContent) }),
        options.agent.promptTimeoutMs ?? DEFAULT_ACP_PROMPT_TIMEOUT_MS,
      );
      options.onEvent({ type: "status", status: "idle", message: "ACP prompt completed" });
    } catch (error) {
      options.onEvent({
        type: "error",
        code: "ACP_PROMPT_FAILED",
        message: error instanceof Error ? error.message : "Failed to send ACP prompt.",
      });
      options.onEvent({ type: "status", status: "error", message: "ACP prompt failed" });
    }
  };

  const configure = async (nextConfig: { agentMode?: string; model?: string; reasoningEffort?: SessionReasoningEffort }) => {
    let runtimeApplied = false;

    const applyOption = async (category: "mode" | "model" | "thought_level", value: string | undefined) => {
      const applied = await applyConfigOption(category, value);
      if (!applied) {
        return false;
      }
      options.onEvent({
        type: "config-options",
        state: resolveSessionConfigState(currentConfigOptions),
        options: currentConfigOptions,
      });
      runtimeApplied = true;
      return true;
    };

    if (nextConfig.agentMode && hasSessionConfigOptionValue(currentConfigOptions, "mode", nextConfig.agentMode)) {
      await applyOption("mode", nextConfig.agentMode);
    }

    if (nextConfig.model && hasSessionConfigOptionValue(currentConfigOptions, "model", nextConfig.model)) {
      await applyOption("model", nextConfig.model);
    } else if (nextConfig.model && currentModelState?.options.some((model) => model.id === nextConfig.model)) {
      await withSdkRequest("session/set_model", agent.unstable_setSessionModel({ sessionId: sessionToken, modelId: nextConfig.model }), 15_000);
      currentModelState = {
        ...currentModelState,
        currentModelId: nextConfig.model,
      };
      options.onEvent({
        type: "model-options",
        state: currentModelState,
      });
      runtimeApplied = true;
    } else {
      await applyOption("model", nextConfig.model);
    }
    await applyOption("thought_level", nextConfig.reasoningEffort);

    return {
      runtimeApplied,
      state: resolveCombinedSessionConfigState(currentConfigOptions, currentModelState),
      modelState: currentModelState,
    };
  };

  const respondPermission = (requestId: string, decision: PermissionDecision) => {
    const pendingPermission = pendingPermissionReplies.get(requestId);
    if (!pendingPermission) {
      options.onEvent({
        type: "error",
        code: "ACP_PERMISSION_MISSING",
        message: "Permission request is no longer pending in the ACP runtime.",
      });
      return;
    }

    pendingPermissionReplies.delete(requestId);
    if (pendingPermission.kind === "client") {
      pendingPermission.resolve(decision === "allow");
      options.onEvent({
        type: "status",
        status: decision === "allow" ? "running" : "idle",
        message: decision === "allow" ? "Client operation permission granted" : "Client operation permission denied",
      });
      return;
    }

    const optionId = decision === "allow" ? pendingPermission.allowOptionId : pendingPermission.denyOptionId;
    if (!optionId) {
      options.onEvent({
        type: "error",
        code: "ACP_PERMISSION_OPTION_UNSUPPORTED",
        message: `ACP permission request does not expose a ${decision} option.`,
      });
      return;
    }

    pendingPermission.resolve({
      outcome: {
        outcome: "selected",
        optionId,
      },
    });
    options.onEvent({
      type: "status",
      status: "running",
      message: "Permission decision sent to ACP runtime",
    });
  };

  const deleteSession = async () => {
    if (!sessionCapabilities.sessionDelete) {
      return {
        kind: "unsupported" as const,
        providerId: options.agent.id,
        message: `${options.agent.name} does not advertise ACP session/delete.`,
      };
    }

    try {
      await withSdkRequest("session/delete", agent.extMethod("session/delete", { sessionId: sessionToken }), 15_000);
      return {
        kind: "remote-deleted" as const,
        providerId: options.agent.id,
        message: `${options.agent.name} remote session deleted: ${sessionToken}`,
      };
    } catch (error) {
      return {
        kind: "remote-delete-failed" as const,
        providerId: options.agent.id,
        message: error instanceof Error ? error.message : `Failed to delete remote session ${sessionToken}`,
      };
    }
  };

  const close = async () => {
    if (!sessionCapabilities.sessionClose) {
      terminateChildProcess(child.pid);
      return {
        kind: "unsupported" as const,
        providerId: options.agent.id,
        message: `${options.agent.name} does not advertise ACP session/close; terminated local runtime process only.`,
      };
    }

    try {
      await withSdkRequest("session/close", agent.closeSession({ sessionId: sessionToken }), 15_000);
      terminateChildProcess(child.pid);
      return {
        kind: "remote-closed" as const,
        providerId: options.agent.id,
        message: `${options.agent.name} remote session closed: ${sessionToken}`,
      };
    } catch (error) {
      terminateChildProcess(child.pid);
      return {
        kind: "remote-close-failed" as const,
        providerId: options.agent.id,
        message: error instanceof Error ? error.message : `Failed to close remote session ${sessionToken}`,
      };
    }
  };

  const cancel = () => {
    cancelled = true;
    failPendingPermissions();
    const killTimeout = setTimeout(() => terminateChildProcess(child.pid), 1_000);
    void agent.cancel({ sessionId: sessionToken })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(killTimeout);
        terminateChildProcess(child.pid);
      });
    options.onEvent({ type: "status", status: "cancelled", message: "Cancelled by remote operator" });
  };

  return {
    runtimeSessionId: sessionToken,
    sessionCapabilities,
    sessionConfigState: resolveCombinedSessionConfigState(currentConfigOptions, currentModelState),
    sessionModelState: currentModelState,
    prompt,
    configure,
    respondPermission,
    deleteSession,
    close,
    cancel,
    supportsPermissionResponses: true,
  };
}


export function resolveSessionCapabilities(initializeResult: any, provider?: AcpAgentProvider): DetectedAcpSessionCapabilities {
  const capabilities = initializeResult?.capabilities ?? initializeResult?.agentCapabilities ?? initializeResult?.sessionCapabilities ?? {};
  const nestedSession = capabilities.session ?? capabilities.sessions ?? capabilities.sessionCapabilities ?? initializeResult?.sessionCapabilities ?? {};
  const promptCapabilities = initializeResult?.promptCapabilities ?? capabilities.promptCapabilities ?? capabilities.prompt ?? {};
  const providerCapabilities = provider?.capabilities ?? {};

  const detected = {
    sessionLoad: Boolean(
      providerCapabilities.sessionLoad ??
        capabilities.loadSession ??
        capabilities.sessionLoad ??
        nestedSession.load ??
        nestedSession.loadSession,
    ),
    sessionResume: Boolean(
      providerCapabilities.sessionResume ??
        capabilities.resumeSession ??
        capabilities.sessionResume ??
        nestedSession.resume ??
        nestedSession.resumeSession,
    ),
    sessionList: Boolean(
      providerCapabilities.sessionList ??
        capabilities.listSessions ??
        capabilities.sessionList ??
        nestedSession.list ??
        nestedSession.listSessions,
    ),
    sessionClose: Boolean(
      providerCapabilities.sessionClose ??
        capabilities.closeSession ??
        capabilities.sessionClose ??
        nestedSession.close ??
        nestedSession.closeSession,
    ),
    sessionDelete: Boolean(
      providerCapabilities.sessionDelete ??
        capabilities.deleteSession ??
        capabilities.sessionDelete ??
        nestedSession.delete ??
        nestedSession.deleteSession,
    ),
    imageInput: Boolean(providerCapabilities.imageInput ?? promptCapabilities.image ?? promptCapabilities.images ?? capabilities.imageInput),
  };

  return provider ? resolveAdapterCapabilities(provider, initializeResult, detected) : detected;
}

type ManagedSdkTerminal = {
  id: string;
  process: ReturnType<typeof spawn>;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitStatus?: { exitCode: number | null; signal: string | null };
  exitPromise: Promise<{ exitCode: number | null; signal: string | null }>;
};

function resolveContainedWorkspacePath(workspaceRoot: string, requestPath: string) {
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, requestPath);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`ACP client file path escapes workspace: ${requestPath}`);
  }
  return candidate;
}

function sliceTextFileContent(content: string, line?: number | null, limit?: number | null) {
  if (!line && !limit) {
    return content;
  }
  const lines = content.split(/\r?\n/u);
  const start = Math.max((line ?? 1) - 1, 0);
  const end = limit && limit > 0 ? start + limit : undefined;
  return lines.slice(start, end).join("\n");
}

function formatTerminalCommand(command: string, args: string[]) {
  return [command, ...args].map((value) => /\s/u.test(value) ? JSON.stringify(value) : value).join(" ");
}

function mergeTerminalEnv(baseEnv: NodeJS.ProcessEnv, env: acp.EnvVariable[]) {
  const merged: NodeJS.ProcessEnv = { ...baseEnv };
  for (const item of env) {
    merged[item.name] = item.value;
  }
  return merged;
}

function requireTerminal(terminals: Map<string, ManagedSdkTerminal>, terminalId: string) {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    throw new Error(`Unknown ACP terminal: ${terminalId}`);
  }
  return terminal;
}

function emitTerminalChunk(
  terminal: ManagedSdkTerminal,
  stream: "stdout" | "stderr",
  text: string,
  onEvent: (event: SessionRuntimeEvent) => void,
) {
  if (!text) {
    return;
  }
  const retained = retainTerminalOutput(`${terminal.output}${text}`, terminal.outputByteLimit);
  terminal.output = retained.output;
  terminal.truncated = terminal.truncated || retained.truncated;
  onEvent({
    type: "command-output",
    chunk: {
      id: `${terminal.id}-${Date.now()}-${stream}`,
      commandId: terminal.id,
      text,
      stream,
      timestamp: new Date().toISOString(),
    },
  });
}

function retainTerminalOutput(output: string, limit: number) {
  if (limit <= 0 || Buffer.byteLength(output, "utf8") <= limit) {
    return { output, truncated: false };
  }

  let retained = output;
  while (retained.length > 0 && Buffer.byteLength(retained, "utf8") > limit) {
    retained = retained.slice(1);
  }
  return { output: retained, truncated: true };
}

function formatAcpError(error: { message?: string; data?: unknown }) {
  const detail =
    typeof error?.data === "string"
      ? error.data
      : typeof (error?.data as { details?: unknown } | undefined)?.details === "string"
        ? (error.data as { details: string }).details
        : null;

  return detail ? `${error?.message ?? "ACP request failed"}: ${detail}` : error?.message ?? "ACP request failed";
}

export function resolvePreferredAgentId(provider: Pick<AcpAgentProvider, "defaultAgent">) {
  return normalizePreferredAgentId(provider.defaultAgent);
}

function normalizePreferredAgentId(agent: string | undefined) {
  if (!agent) {
    return undefined;
  }

  const trimmed = agent.trim();
  if (!trimmed) {
    return undefined;
  }

  const canonical = trimmed
    .replace(/\s+-\s+.*/u, "")
    .replace(/\s+/gu, "-")
    .toLowerCase();

  const aliasMap: Record<string, string> = {
    sisyphus: "sisyphus",
    atlas: "atlas",
    prometheus: "prometheus",
    hephaestus: "hephaestus",
    oracle: "oracle",
    metis: "metis",
    momus: "momus",
    build: "build",
    plan: "plan",
    general: "general",
    explore: "explore",
    summary: "summary",
    title: "title",
    compaction: "compaction",
  };

  return aliasMap[canonical] ?? canonical;
}


function writeProtocolLog(logFile: string, stream: "stdin" | "stdout", payload: unknown) {
  writeLogLine(logFile, stream, JSON.stringify(sanitizeProtocolLogPayload(payload)));
}

export function sanitizeProtocolLogPayload(payload: unknown): unknown {
  if (!payloadHasRedactableField(payload)) {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeProtocolLogPayload(item));
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = shouldRedactProtocolLogField(key, value) ? redactProtocolLogValue(value) : sanitizeProtocolLogPayload(value);
  }
  return sanitized;
}

function payloadHasRedactableField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(payloadHasRedactableField);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (shouldRedactProtocolLogField(key, child)) {
      return true;
    }
    if (payloadHasRedactableField(child)) {
      return true;
    }
  }
  return false;
}

function shouldRedactProtocolLogField(key: string, value: unknown) {
  return typeof value === "string" && /^(text|output|patch|content)$/iu.test(key);
}

function redactProtocolLogValue(value: unknown) {
  return typeof value === "string" ? `[redacted chars=${value.length}]` : "[redacted]";
}

function writeChunkLog(logFile: string, stream: string, chunk: string) {
  const trimmed = chunk.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  writeLogLine(logFile, stream, trimmed);
}

function writeLogLine(logFile: string, stream: string, message: string) {
  appendFileSync(logFile, `${new Date().toISOString()} [${stream}] ${message}\n`, "utf8");
}

function sanitizeLogToken(value: string) {
  return value.replace(/[^a-z0-9._-]+/giu, "-");
}

// TODO(real-acp): introduce createAcpRuntime(provider, workspace) using stdio JSON-RPC notifications beyond initialize.
// TODO(real-acp): normalize ACP raw notifications into SessionRuntimeEvent here instead of leaking protocol details upward.


export { resolveRuntimeSessionId } from "./requests";

export { mapSessionUpdateNotification, normalizeProviderCleanupResult } from "./events";

export { applySessionLaunchOverrides, buildOpenCodeConfigOverride, resolveSessionEnvOverrides } from "./config-adapters";
export { createClaudeAcpAdapter, createCodexAcpAdapter, createGenericAcpAdapter, createOpenClawAcpAdapter, createOpenCodeAcpAdapter, resolveAcpAgentAdapter, resolveAcpLaunchConfig, resolveAdapterCleanupPlan, type AcpAgentAdapter, type AcpLaunchContext, type AcpLaunchSpec, type ProviderCleanupPlan } from "./adapters";
