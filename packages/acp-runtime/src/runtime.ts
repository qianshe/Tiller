import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLaunchSpec, terminateChildProcess } from "./process";
import { resolveAcpLaunchConfig, resolveAdapterCapabilities } from "./adapters";
import { extractAcpModelState, extractSessionConfigOptions, findSessionConfigOptionId, hasOpenCodePortArg, hasSessionConfigOptionValue, mapPermissionRequest, mapSessionUpdateNotification, normalizeProviderCleanupResult, resolveCombinedSessionConfigState, resolveSessionConfigState } from "./events";
import { buildSessionCloseRequest, buildSessionDeleteRequest, buildSessionListRequest, buildSessionLoadRequest, buildSessionNewRequest, buildSessionPromptRequest, buildSessionResumeRequest, buildSessionSetConfigOptionRequest, buildSessionSetModelRequest, resolveRuntimeSessionId } from "./requests";
import type {
  AcpAgentProvider,
  AcpAgentSessionInfo,
  AcpModelOption,
  AcpModelState,
  AgentMessage,
  AgentPromptContent,
  AgentToolCall,
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
    `Starting ACP connection test command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    const child = spawn(launchSpec.command, launchSpec.args, {
      cwd: launchCwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const finalize = (result: { ok: boolean; message: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      terminateChildProcess(child.pid);
      resolve(result);
    };

    const tryParseInitialize = (text: string) => {
      if (!text.trim()) {
        return false;
      }

      try {
        const payload = JSON.parse(text);
        if (payload.id === "tiller-init" && payload.result) {
          const agentName = payload.result.agentInfo?.name ?? provider.name;
          const version = payload.result.agentInfo?.version ? ` v${payload.result.agentInfo.version}` : "";
          finalize({ ok: true, message: `ACP initialize passed for ${agentName}${version}.` });
          return true;
        }
      } catch {
        return false;
      }

      return false;
    };

    child.on("error", (error) => {
      writeLogLine(logFile, "process-error", error.message);
      finalize({ ok: false, message: `Failed to start ACP command: ${error.message}` });
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderrBuffer += text;
      writeChunkLog(logFile, "stderr", text);
      if (ACP_EARLY_STDERR_FAILURE.test(stderrBuffer)) {
        finalize({ ok: false, message: stderrBuffer.trim() });
      }
    });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdoutBuffer += text;
      writeChunkLog(logFile, "stdout", text);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (tryParseInitialize(line)) {
          return;
        }
      }

      tryParseInitialize(stdoutBuffer);
    });

    child.on("exit", (code) => {
      writeLogLine(logFile, "exit", `code=${code ?? "unknown"}`);
      if (!settled) {
        if (tryParseInitialize(stdoutBuffer)) {
          return;
        }
        finalize({
          ok: false,
          message: stderrBuffer.trim() || `ACP command exited before initialize completed (code ${code ?? "unknown"}).`,
        });
      }
    });

    const timeout = setTimeout(() => {
      if (tryParseInitialize(stdoutBuffer)) {
        return;
      }
      finalize({
        ok: false,
        message: stderrBuffer.trim() || "Timed out waiting for ACP initialize response.",
      });
    }, initializeTimeoutMs);

    const initializePayload = {
      jsonrpc: "2.0",
      id: "tiller-init",
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
          terminal: false,
        },
        clientInfo: {
          name: "tiller-helm",
          version: "0.1.0",
        },
      },
    };
    writeProtocolLog(logFile, "stdin", initializePayload);
    child.stdin.write(`${JSON.stringify(initializePayload)}\n`);
  });
}

export async function listAcpAgentSessions(provider: AcpAgentProvider, workspace: WorkspaceSummary, cursor?: string): Promise<AcpAgentSessionListResult> {
  const launchConfig = resolveAcpLaunchConfig(provider, { fallbackCwd: workspace.path });
  const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
  const launchCwd = launchConfig.cwd;
  const childEnv = { ...process.env, ...launchConfig.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.TSX_TSCONFIG_PATH;
  delete childEnv.TSX_DISABLE_CACHE;
  const preferredAgent = resolvePreferredAgentId(provider);
  const logFile = resolve(ACP_LOGS_DIR, `session-list-${sanitizeLogToken(provider.id)}.log`);
  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let closed = false;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const waiter of pending.values()) {
      waiter.reject(new Error("ACP process closed before request completed."));
    }
    pending.clear();
  };

  const sendRequest = async <T>(payload: Record<string, unknown>, timeoutMs = provider.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS) => {
    const id = String(payload.id);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(stderrBuffer.trim() || `Timed out waiting for ACP response: ${String(payload.method)}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      writeProtocolLog(logFile, "stdin", payload);
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  };

  const handleProtocolMessage = (line: string) => {
    if (!line.trim()) {
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.id && pending.has(String(payload.id))) {
      writeProtocolLog(logFile, "stdout", payload);
      const waiter = pending.get(String(payload.id))!;
      pending.delete(String(payload.id));
      if (payload.error) {
        waiter.reject(new Error(formatAcpError(payload.error)));
        return;
      }
      waiter.resolve(payload.result);
    }
  };

  child.on("error", (error) => {
    writeLogLine(logFile, "process-error", error.message);
    cleanup();
  });
  child.on("exit", (code) => {
    writeLogLine(logFile, "exit", `code=${code ?? "unknown"}`);
    cleanup();
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
  });
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdoutBuffer += text;
    writeChunkLog(logFile, "stdout-raw", text);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleProtocolMessage(line);
    }
    if (stdoutBuffer.trim().startsWith("{") && stdoutBuffer.trim().endsWith("}")) {
      handleProtocolMessage(stdoutBuffer.trim());
      stdoutBuffer = "";
    }
  });

  try {
    const initializeResult = await sendRequest<any>({
      jsonrpc: "2.0",
      id: "tiller-list-init",
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "tiller-helm", version: "0.1.0" },
      },
    });
    const sessionCapabilities = resolveSessionCapabilities(initializeResult, provider);
    if (!sessionCapabilities.sessionList) {
      throw new Error("ACP agent does not advertise session/list capability.");
    }
    const result = await sendRequest<any>(buildSessionListRequest("tiller-list-sessions", launchCwd, preferredAgent, cursor), 15_000);
    return normalizeAcpAgentSessionListResult(result);
  } finally {
    terminateChildProcess(child.pid);
    cleanup();
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
  const preferredAgent = resolvePreferredAgentId(options.agent);
  const logFile = resolve(ACP_LOGS_DIR, `session-${sanitizeLogToken(options.sessionId)}.log`);

  writeLogLine(
    logFile,
    "meta",
    `Starting ACP session agent=${options.agent.id} command=${launchSpec.command} args=${JSON.stringify(launchSpec.args)} cwd=${launchCwd}`,
  );

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchCwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  const pendingPermissionReplies = new Map<string, { allowOptionId?: string; denyOptionId?: string }>();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let cancelled = false;
  let closed = false;
  let sessionToken = "";
  let requestCounter = 0;

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const waiter of pending.values()) {
      waiter.reject(new Error("ACP process closed before request completed."));
    }
    pending.clear();
    pendingPermissionReplies.clear();
  };

  const nextRpcId = () => `tiller-rpc-${++requestCounter}`;

  const sendNotification = (payload: Record<string, unknown>) => {
    writeProtocolLog(logFile, "stdin", payload);
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const sendRequest = async <T>(payload: Record<string, unknown>, timeoutMs = options.agent.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS) => {
    const id = String(payload.id);

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(stderrBuffer.trim() || `Timed out waiting for ACP response: ${String(payload.method)}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      sendNotification(payload);
    });
  };

  const handleProtocolMessage = (line: string) => {
    if (!line.trim()) {
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.method === "session/request_permission" && payload.id) {
      writeProtocolLog(logFile, "stdout", payload);
      const permissionRequest = mapPermissionRequest(payload, sessionToken || options.sessionId, launchCwd);
      if (!permissionRequest) {
        sendNotification({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            outcome: {
              outcome: "cancelled",
            },
          },
        });
        return;
      }

      pendingPermissionReplies.set(permissionRequest.id, {
        allowOptionId: permissionRequest.allowOptionId,
        denyOptionId: permissionRequest.denyOptionId,
      });
      options.onEvent({
        type: "status",
        status: "waiting_for_permission",
        message: "ACP agent requested permission",
      });
      options.onEvent({
        type: "permission-request",
        request: permissionRequest.request,
      });
      return;
    }

    if (payload.id && pending.has(String(payload.id))) {
      writeProtocolLog(logFile, "stdout", payload);
      const waiter = pending.get(String(payload.id))!;
      pending.delete(String(payload.id));
      if (payload.error) {
        waiter.reject(new Error(formatAcpError(payload.error)));
        return;
      }
      waiter.resolve(payload.result);
      return;
    }

    const mapped = mapSessionUpdateNotification(payload);
    if (mapped && mapped.sessionId === sessionToken) {
      if (mapped.event.type === "config-options") {
        currentConfigOptions = mapped.event.options;
      }
      writeProtocolLog(logFile, "stdout", payload);
      options.onEvent(mapped.event);
    }
  };

  child.on("error", (error) => {
    writeLogLine(logFile, "process-error", error.message);
    options.onEvent({ type: "error", code: "ACP_LAUNCH_FAILED", message: `Failed to start ACP command: ${error.message}` });
    cleanup();
  });

  child.on("exit", (code) => {
    writeLogLine(logFile, "exit", `code=${code ?? "unknown"}`);
    cleanup();
    if (!cancelled) {
      options.onEvent({
        type: "status",
        status: code === 0 ? "idle" : "error",
        message: code === 0 ? "ACP session closed" : `ACP process exited with code ${code ?? "unknown"}`,
      });
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    writeChunkLog(logFile, "stderr", text);
    if (ACP_EARLY_STDERR_FAILURE.test(stderrBuffer)) {
      options.onEvent({ type: "error", code: "ACP_STDERR", message: stderrBuffer.trim() });
    }
  });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdoutBuffer += text;
    writeChunkLog(logFile, "stdout-raw", text);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleProtocolMessage(line);
    }
    if (stdoutBuffer.trim().startsWith("{") && stdoutBuffer.trim().endsWith("}")) {
      handleProtocolMessage(stdoutBuffer.trim());
      stdoutBuffer = "";
    }
  });

  options.onEvent({ type: "status", status: "starting", message: "Launching ACP session" });

  const initializeResult = await sendRequest<any>({
    jsonrpc: "2.0",
    id: "tiller-init",
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "tiller-helm", version: "0.1.0" },
    },
  });
  const sessionCapabilities = resolveSessionCapabilities(initializeResult, options.agent);
  let currentConfigOptions: AcpSessionConfigOption[] = [];
  let currentModelState: AcpModelState | undefined;

  if (options.restore) {
    sessionToken = options.restore.runtimeSessionId;
    if (options.restore.strategy === "load") {
      if (!sessionCapabilities.sessionLoad) {
        throw new Error("ACP agent does not advertise session/load capability.");
      }
      const loadResult = await sendRequest<AcpSessionResponseWithModels>(
        buildSessionLoadRequest(nextRpcId(), options.restore.runtimeSessionId, launchCwd, preferredAgent),
      );
      sessionToken = resolveRuntimeSessionId(loadResult, options.restore.runtimeSessionId);
      currentConfigOptions = extractSessionConfigOptions(loadResult);
      currentModelState = extractAcpModelState(loadResult);
    } else {
      if (!sessionCapabilities.sessionResume) {
        throw new Error("ACP agent does not advertise session.resume capability.");
      }
      const resumeResult = await sendRequest<AcpSessionResponseWithModels>(
        buildSessionResumeRequest(nextRpcId(), options.restore.runtimeSessionId, launchCwd, preferredAgent),
      );
      sessionToken = resolveRuntimeSessionId(resumeResult, options.restore.runtimeSessionId);
      currentConfigOptions = extractSessionConfigOptions(resumeResult);
      currentModelState = extractAcpModelState(resumeResult);
    }
  } else {
    const sessionResult = await sendRequest<AcpSessionResponseWithModels>(
      buildSessionNewRequest(nextRpcId(), launchCwd, preferredAgent),
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

    const result = await sendRequest<any>(buildSessionSetConfigOptionRequest(nextRpcId(), sessionToken, optionId, value), timeoutMs);
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
    const hasImages = content?.some((item) => item.type === "image") ?? false;
    if (hasImages && !sessionCapabilities.imageInput) {
      options.onEvent({
        type: "error",
        code: "ACP_IMAGE_INPUT_UNSUPPORTED",
        message: "ACP agent does not advertise image prompt capability.",
      });
      options.onEvent({ type: "status", status: "error", message: "ACP image prompt unsupported" });
      return;
    }

    options.onEvent({ type: "status", status: "running", message: "ACP agent is responding" });
    try {
      await sendRequest(buildSessionPromptRequest(nextRpcId(), sessionToken, text, preferredAgent, content), options.agent.promptTimeoutMs ?? DEFAULT_ACP_PROMPT_TIMEOUT_MS);
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
      await sendRequest(buildSessionSetModelRequest(nextRpcId(), sessionToken, nextConfig.model), 15_000);
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

    const optionId = decision === "allow" ? pendingPermission.allowOptionId : pendingPermission.denyOptionId;
    if (!optionId) {
      options.onEvent({
        type: "error",
        code: "ACP_PERMISSION_OPTION_UNSUPPORTED",
        message: `ACP permission request does not expose a ${decision} option.`,
      });
      return;
    }

    pendingPermissionReplies.delete(requestId);
    sendNotification({
      jsonrpc: "2.0",
      id: requestId,
      result: {
        outcome: {
          outcome: "selected",
          optionId,
        },
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
      await sendRequest(buildSessionDeleteRequest(nextRpcId(), sessionToken, preferredAgent), 15_000);
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
      await sendRequest(buildSessionCloseRequest(nextRpcId(), sessionToken, preferredAgent), 15_000);
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
    terminateChildProcess(child.pid);
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

function timestamp() {
  return new Date().toISOString();
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
  writeLogLine(logFile, stream, JSON.stringify(payload));
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


export { buildSessionCloseRequest, buildSessionDeleteRequest, buildSessionListRequest, buildSessionLoadRequest, buildSessionNewRequest, buildSessionPromptRequest, buildSessionResumeRequest, buildSessionSetConfigOptionRequest, buildSessionSetModelRequest, resolveRuntimeSessionId } from "./requests";

export { mapSessionUpdateNotification, normalizeProviderCleanupResult } from "./events";

export { applySessionLaunchOverrides, buildOpenCodeConfigOverride, resolveSessionEnvOverrides } from "./config-adapters";
export { createCodexAcpAdapter, createGenericAcpAdapter, createOpenCodeAcpAdapter, resolveAcpAgentAdapter, resolveAcpLaunchConfig, resolveAdapterCleanupPlan, type AcpAgentAdapter, type AcpLaunchContext, type AcpLaunchSpec, type ProviderCleanupPlan } from "./adapters";
