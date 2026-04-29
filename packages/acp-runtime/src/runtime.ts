import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSessionLoadRequest, buildSessionNewRequest, buildSessionPromptRequest, buildSessionResumeRequest, buildSessionSetModelRequest, resolveRuntimeSessionId } from "./requests";
import type {
  AcpAgentProvider,
  AcpModelOption,
  AcpModelState,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionReasoningEffort,
  SessionStatus,
  WorkspaceSummary,
} from "@tiller/shared";

const ACP_INITIALIZE_TIMEOUT_MS = 10_000;
const ACP_EARLY_STDERR_FAILURE = /failed to start server|eaddrinuse|address already in use/i;

export type ProviderCleanupResult =
  | { kind: "unsupported"; providerId: string; message: string }
  | { kind: "remote-deleted"; providerId: string; message: string }
  | { kind: "remote-delete-failed"; providerId: string; message: string };
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
};

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
  const launchSpec = resolveLaunchSpec(provider.command, provider.args ?? []);
  const launchCwd = existsSync(provider.cwd ?? "") ? provider.cwd! : existsSync(cwd) ? cwd : process.cwd();
  const childEnv = { ...process.env, ...provider.env };
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

export async function createAcpRuntime(options: AcpRuntimeOptions) {
  const launchSpec = resolveLaunchSpec(options.agent.command, options.agent.args ?? [], options.sessionConfig);
  const launchCwd = existsSync(options.agent.cwd ?? "") ? options.agent.cwd! : existsSync(options.workspace.path) ? options.workspace.path : process.cwd();
  const sessionEnvOverrides = resolveSessionEnvOverrides(options.agent.command, options.sessionConfig);
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...options.agent.env, ...sessionEnvOverrides };
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

  const prompt = async (text: string) => {
    options.onEvent({ type: "status", status: "running", message: "ACP agent is responding" });
    try {
      await sendRequest(buildSessionPromptRequest(nextRpcId(), sessionToken, text, preferredAgent), 30_000);
    } catch (error) {
      options.onEvent({
        type: "error",
        code: "ACP_PROMPT_FAILED",
        message: error instanceof Error ? error.message : "Failed to send ACP prompt.",
      });
      options.onEvent({ type: "status", status: "error", message: "ACP prompt failed" });
    }
  };

  const configure = async (nextConfig: { model?: string; reasoningEffort?: SessionReasoningEffort }) => {
    let runtimeApplied = false;

    const applyOption = async (category: "model" | "thought_level", value: string | undefined) => {
      if (!value) {
        return false;
      }

      const optionId = findSessionConfigOptionId(currentConfigOptions, category);
      if (!optionId) {
        return false;
      }

      const result = await sendRequest<any>({
        jsonrpc: "2.0",
        id: nextRpcId(),
        method: "session/set_config_option",
        params: {
          sessionId: sessionToken,
          optionId,
          value,
        },
      }, 15_000);
      const nextOptions = extractSessionConfigOptions(result);
      if (nextOptions.length) {
        currentConfigOptions = nextOptions;
        options.onEvent({
          type: "config-options",
          state: resolveSessionConfigState(currentConfigOptions),
          options: currentConfigOptions,
        });
      }
      runtimeApplied = true;
      return true;
    };

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
    cancel,
    supportsPermissionResponses: true,
  };
}


export function resolveSessionCapabilities(initializeResult: any, provider?: AcpAgentProvider): DetectedAcpSessionCapabilities {
  const capabilities = initializeResult?.capabilities ?? initializeResult?.agentCapabilities ?? initializeResult?.sessionCapabilities ?? {};
  const nestedSession = capabilities.session ?? capabilities.sessions ?? initializeResult?.sessionCapabilities ?? {};
  const providerCapabilities = provider?.capabilities ?? {};

  return {
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
  };
}

export function mapSessionUpdateNotification(payload: any): { sessionId: string; event: SessionRuntimeEvent } | null {
  if (payload?.method !== "session/update") {
    return null;
  }

  const sessionId = payload?.params?.sessionId;
  const update = payload?.params?.update;
  if (!sessionId || !update) {
    return null;
  }

  const updateType = update.sessionUpdate ?? update.type;
  const text = extractTextContent(update.content) ?? extractTextContent(update.delta) ?? extractTextContent(update.message);

  if (text && updateType === "agent_message_chunk") {
    return {
      sessionId,
      event: {
        type: "message",
        message: {
          id: update.messageId ?? `${sessionId}-msg-${Date.now()}`,
          role: "assistant",
          text,
          timestamp: timestamp(),
        },
      },
    };
  }

  const configOptions = extractSessionConfigOptions(update);
  if (configOptions.length && updateType === "config_option_update") {
    return {
      sessionId,
      event: {
        type: "config-options",
        state: resolveSessionConfigState(configOptions),
        options: configOptions,
      },
    };
  }

  const explicitToolCall = extractToolCall(sessionId, updateType, update);
  if (explicitToolCall) {
    return {
      sessionId,
      event: {
        type: "tool-call",
        toolCall: explicitToolCall,
      },
    };
  }

  const permissionRequest = extractPermissionRequest(sessionId, updateType, update);
  if (permissionRequest) {
    return {
      sessionId,
      event: {
        type: "permission-request",
        request: permissionRequest,
      },
    };
  }

  const commandChunk = extractCommandChunk(sessionId, updateType, update);
  if (commandChunk) {
    return {
      sessionId,
      event: {
        type: "command-output",
        chunk: commandChunk,
        toolCall: mapCommandChunkToToolCall(commandChunk),
      },
    };
  }

  const diffFiles = extractDiffFiles(updateType, update);
  if (diffFiles) {
    return {
      sessionId,
      event: {
        type: "diff-update",
        files: diffFiles,
      },
    };
  }

  const status = normalizeSessionStatus(updateType);
  if (status) {
    return {
      sessionId,
      event: {
        type: "status",
        status,
        message: typeof update.message === "string" ? update.message : undefined,
      },
    };
  }

  return null;
}

function extractSessionConfigOptions(payload: any): AcpSessionConfigOption[] {
  const rawOptions = Array.isArray(payload?.configOptions)
    ? payload.configOptions
    : Array.isArray(payload?.sessionConfig?.configOptions)
      ? payload.sessionConfig.configOptions
      : Array.isArray(payload?.update?.configOptions)
        ? payload.update.configOptions
        : [];

  return rawOptions
    .filter((option: any) => option && typeof option.id === "string")
    .map((option: any) => ({
      id: String(option.id),
      name: typeof option.name === "string" ? option.name : undefined,
      category: typeof option.category === "string" ? option.category : undefined,
      currentValue: option.currentValue,
      selectedValue: option.selectedValue,
      value: option.value,
      options: Array.isArray(option.options)
        ? option.options.map((item: any) => ({
            value: item?.value,
            label: typeof item?.label === "string" ? item.label : typeof item?.name === "string" ? item.name : undefined,
            name: typeof item?.name === "string" ? item.name : undefined,
          }))
        : undefined,
    }));
}

function extractAcpModelState(payload: AcpSessionResponseWithModels | any): AcpModelState | undefined {
  const rawModels = payload?.models as AcpProtocolSessionModelState | undefined | null;
  const rawAvailableModels = rawModels?.availableModels ?? rawModels?.available_models;
  if (!rawModels || !Array.isArray(rawAvailableModels)) {
    return undefined;
  }

  const options = rawAvailableModels
    .map(normalizeAcpModelInfo)
    .filter((model): model is AcpModelOption => Boolean(model));
  if (!options.length) {
    return undefined;
  }

  return {
    currentModelId: typeof rawModels.currentModelId === "string" ? rawModels.currentModelId : typeof rawModels.current_model_id === "string" ? rawModels.current_model_id : undefined,
    options,
  };
}

function normalizeAcpModelInfo(model: AcpProtocolModelInfo): AcpModelOption | null {
  const modelId = model?.modelId ?? model?.model_id ?? model?.id;
  if (typeof modelId !== "string" || !modelId.trim()) {
    return null;
  }

  return {
    id: modelId,
    name: typeof model.name === "string" && model.name.trim() ? model.name : modelId,
    description: typeof model.description === "string" && model.description.trim() ? model.description : undefined,
  };
}

function resolveCombinedSessionConfigState(configOptions: AcpSessionConfigOption[], modelState?: AcpModelState): AcpSessionConfigState {
  const state = resolveSessionConfigState(configOptions);
  return {
    ...state,
    ...(!state.model && modelState?.currentModelId ? { model: modelState.currentModelId } : {}),
  };
}

function hasSessionConfigOptionValue(configOptions: AcpSessionConfigOption[], category: string, value: string) {
  const option = configOptions.find((item) => item.category?.toLowerCase() === category);
  if (!option) {
    return false;
  }

  const candidates = [option.currentValue, option.selectedValue, option.value, ...(option.options ?? []).map((item) => item.value)];
  return candidates.some((candidate) => candidate === value);
}

function hasOpenCodePortArg(args: string[]) {
  return args.some((value, index) => value === "--port" || value.startsWith("--port=") || args[index - 1] === "--port");
}

function resolveSessionConfigState(configOptions: AcpSessionConfigOption[]): AcpSessionConfigState {
  const state: AcpSessionConfigState = {};
  const modelValue = readSessionConfigValue(configOptions, "model");
  if (typeof modelValue === "string" && modelValue) {
    state.model = modelValue;
  }

  const reasoningValue = readSessionConfigValue(configOptions, "thought_level");
  if (typeof reasoningValue === "string" && reasoningValue) {
    state.reasoningEffort = reasoningValue as SessionReasoningEffort;
  }

  return state;
}

function readSessionConfigValue(configOptions: AcpSessionConfigOption[], category: string) {
  const option = configOptions.find((item) => item.category?.toLowerCase() === category);
  return option?.currentValue ?? option?.selectedValue ?? option?.value;
}

function findSessionConfigOptionId(configOptions: AcpSessionConfigOption[], category: string) {
  return configOptions.find((item) => item.category?.toLowerCase() === category)?.id;
}

function resolveLaunchSpec(
  command: string,
  args: string[],
  sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort },
) {
  const runtimeArgs = applySessionLaunchOverrides(command, args, sessionConfig);
  if (process.platform !== "win32") {
    return { command, args: runtimeArgs };
  }

  const resolvedCommand = resolveWindowsCommand(command);
  if (!resolvedCommand.toLowerCase().endsWith(".cmd")) {
    return { command: resolvedCommand, args: runtimeArgs };
  }

  const cmdContent = readFileSync(resolvedCommand, "utf8");
  const scriptMatch = cmdContent.match(/"%_prog%"\s+"([^"]+)"\s+%\*/u);
  if (!scriptMatch) {
    return { command: resolvedCommand, args: runtimeArgs };
  }

  const scriptPath = scriptMatch[1].replace(/%dp0%?/giu, dirname(resolvedCommand).replace(/\\/g, "/"));
  const localNode = join(dirname(resolvedCommand), "node.exe");
  return {
    command: existsSync(localNode) ? localNode : process.execPath,
    args: [scriptPath, ...runtimeArgs],
  };
}

type SessionConfigAdapter = {
  id: string;
  matches: (command: string) => boolean;
  applyLaunchArgs: (args: string[], sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort }) => string[];
  applyEnv: (sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort }) => NodeJS.ProcessEnv;
};

const DEFAULT_SESSION_CONFIG_ADAPTER: SessionConfigAdapter = {
  id: "default",
  matches: () => true,
  applyLaunchArgs: (args) => args,
  applyEnv: () => ({}),
};

const CODEX_SESSION_CONFIG_ADAPTER: SessionConfigAdapter = {
  id: "codex-acp",
  matches: (command) => /^codex-acp(?:\.exe)?$/iu.test(command),
  applyLaunchArgs: (args, sessionConfig) => {
    const nextArgs = [...args];
    if (sessionConfig?.model) {
      nextArgs.push("-c", `model=${JSON.stringify(sessionConfig.model)}`);
    }
    if (sessionConfig?.reasoningEffort) {
      nextArgs.push("-c", `model_reasoning_effort=${JSON.stringify(sessionConfig.reasoningEffort)}`);
    }
    return nextArgs;
  },
  applyEnv: () => ({}),
};

const OPENCODE_SESSION_CONFIG_ADAPTER: SessionConfigAdapter = {
  id: "opencode",
  matches: (command) => /^opencode(?:\.exe)?$/iu.test(command),
  applyLaunchArgs: (args) => {
    const nextArgs = args.filter((value, index, list) => {
      const previous = list[index - 1];
      return value !== "-m" && value !== "--model" && previous !== "-m" && previous !== "--model" && !value.startsWith("--model=");
    });

    if (nextArgs.includes("acp") && !hasOpenCodePortArg(nextArgs)) {
      nextArgs.push("--port", "0");
    }

    return nextArgs;
  },
  applyEnv: (sessionConfig) => {
    const configOverride = buildOpenCodeConfigOverride(sessionConfig);
    if (!configOverride) {
      return {};
    }

    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(configOverride),
    };
  },
};

const SESSION_CONFIG_ADAPTERS: SessionConfigAdapter[] = [
  CODEX_SESSION_CONFIG_ADAPTER,
  OPENCODE_SESSION_CONFIG_ADAPTER,
  DEFAULT_SESSION_CONFIG_ADAPTER,
];

function resolveSessionConfigAdapter(command: string) {
  return SESSION_CONFIG_ADAPTERS.find((adapter) => adapter.matches(command)) ?? DEFAULT_SESSION_CONFIG_ADAPTER;
}

export function applySessionLaunchOverrides(
  command: string,
  args: string[],
  sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort },
) {
  return resolveSessionConfigAdapter(command).applyLaunchArgs(args, sessionConfig);
}

export function resolveSessionEnvOverrides(
  command: string,
  sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort },
): NodeJS.ProcessEnv {
  return resolveSessionConfigAdapter(command).applyEnv(sessionConfig);
}

export function buildOpenCodeConfigOverride(sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort }) {
  if (!sessionConfig?.model && !sessionConfig?.reasoningEffort) {
    return null;
  }

  const nextConfig: Record<string, unknown> = {};
  if (sessionConfig?.model) {
    nextConfig.model = sessionConfig.model;
  }

  if (!sessionConfig?.reasoningEffort || !sessionConfig.model || !sessionConfig.model.includes("/")) {
    return Object.keys(nextConfig).length ? nextConfig : null;
  }

  const [providerId, ...modelParts] = sessionConfig.model.split("/");
  const modelId = modelParts.join("/");
  if (!providerId || !modelId) {
    return Object.keys(nextConfig).length ? nextConfig : null;
  }

  nextConfig.provider = {
    [providerId]: {
      models: {
        [modelId]: {
          options: {
            reasoningEffort: sessionConfig.reasoningEffort,
          },
        },
      },
    },
  };

  return nextConfig;
}

function resolveWindowsCommand(command: string) {
  try {
    const output = execFileSync("where.exe", [command], { encoding: "utf8" });
    const resolved = output.split(/\r?\n/u).find(Boolean)?.trim() ?? command;
    if (!resolved.includes(".") && existsSync(`${resolved}.cmd`)) {
      return `${resolved}.cmd`;
    }
    return resolved;
  } catch {
    return command;
  }
}

function terminateChildProcess(pid: number | undefined) {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
  } catch {
    // best effort fallback below
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore: process already exited
  }
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


function extractToolCall(sessionId: string, updateType: string | undefined, update: any): AgentToolCall | null {
  const type = updateType ?? "";
  if (!/(tool|terminal)/iu.test(type) || /command_output/iu.test(type)) {
    return null;
  }

  const source = update.toolCall ?? update.tool_call ?? update.tool ?? update.terminal ?? update;
  const id = stringFrom(source.id ?? source.toolCallId ?? source.tool_call_id ?? source.callId ?? update.id) ?? `${sessionId}-tool-${Date.now()}`;
  const commandId = stringFrom(source.commandId ?? source.command_id ?? source.terminalId ?? update.commandId);
  const title =
    stringFrom(source.title ?? source.label ?? source.name ?? source.toolName ?? source.tool_name ?? source.command) ??
    commandId ??
    id;
  const output = stringFrom(source.output ?? source.result ?? source.content ?? source.text);
  const input = stringFrom(source.input ?? source.arguments ?? source.args ?? source.params ?? source.command);
  const now = timestamp();

  return {
    id,
    kind: inferToolCallKind(type, source),
    title,
    status: inferToolCallStatus(type, source.status ?? source.state ?? update.status ?? update.state),
    ...(commandId ? { commandId } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(source.stream === "stderr" || source.stream === "stdout" ? { stream: source.stream } : {}),
    timestamp: stringFrom(source.timestamp ?? update.timestamp) ?? now,
    updatedAt: stringFrom(source.updatedAt ?? source.updated_at ?? update.updatedAt ?? update.timestamp) ?? now,
  };
}

function inferToolCallKind(updateType: string, source: any): AgentToolCall["kind"] {
  const raw = String(source.kind ?? source.type ?? updateType).toLowerCase();
  if (/terminal|command|shell|bash|exec/u.test(raw)) {
    return "terminal";
  }
  if (/edit|diff|patch|file/u.test(raw)) {
    return "edit";
  }
  if (/subagent|agent/u.test(raw)) {
    return "subagent";
  }
  if (/tool/u.test(raw)) {
    return "tool";
  }
  return "unknown";
}

function inferToolCallStatus(updateType: string, status: unknown): AgentToolCall["status"] {
  const raw = String(status ?? updateType).toLowerCase();
  if (/fail|error|reject/u.test(raw)) {
    return "failed";
  }
  if (/cancel/u.test(raw)) {
    return "cancelled";
  }
  if (/wait|permission|confirm/u.test(raw)) {
    return "waiting_for_permission";
  }
  if (/complete|done|success|finished|end/u.test(raw)) {
    return "completed";
  }
  if (/pending|start/u.test(raw)) {
    return "pending";
  }
  return "running";
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractPermissionRequest(sessionId: string, updateType: string | undefined, update: any): PermissionRequest | null {
  if (!/permission/iu.test(updateType ?? "")) {
    return null;
  }

  const command = typeof update.command === "string" ? update.command : typeof update.permission?.command === "string" ? update.permission.command : null;
  if (!command) {
    return null;
  }

  return {
    id: update.permissionId ?? update.id ?? `${sessionId}-perm-${Date.now()}`,
    command,
    reason:
      typeof update.reason === "string"
        ? update.reason
        : typeof update.permission?.reason === "string"
          ? update.permission.reason
          : "Agent requested permission.",
    workspacePath:
      typeof update.cwd === "string"
        ? update.cwd
        : typeof update.workspacePath === "string"
          ? update.workspacePath
          : typeof update.permission?.cwd === "string"
            ? update.permission.cwd
            : process.cwd(),
  };
}

function extractCommandChunk(sessionId: string, updateType: string | undefined, update: any): CommandChunk | null {
  if (!/command/iu.test(updateType ?? "")) {
    return null;
  }

  const text =
    typeof update.output === "string"
      ? update.output
      : typeof update.text === "string"
        ? update.text
        : extractTextContent(update.content);
  if (!text) {
    return null;
  }

  return {
    id: update.id ?? `${sessionId}-cmd-${Date.now()}`,
    commandId: update.commandId ?? update.id ?? `${sessionId}-command`,
    text,
    stream: update.stream === "stderr" ? "stderr" : "stdout",
    timestamp: timestamp(),
  };
}


function mapCommandChunkToToolCall(chunk: CommandChunk): AgentToolCall {
  return {
    id: `tool-${chunk.commandId}`,
    kind: "terminal",
    title: chunk.commandId,
    status: chunk.stream === "stderr" ? "failed" : "running",
    commandId: chunk.commandId,
    output: chunk.text,
    stream: chunk.stream,
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
  };
}

function extractDiffFiles(updateType: string | undefined, update: any): FileDiffSummary[] | null {
  if (!/diff/iu.test(updateType ?? "")) {
    return null;
  }

  const files = Array.isArray(update.files) ? update.files : Array.isArray(update.diff?.files) ? update.diff.files : null;
  if (!files?.length) {
    return null;
  }

  return (files as Array<Record<string, unknown>>)
    .filter((item: Record<string, unknown>) => typeof item.path === "string" || typeof item.file === "string")
    .map((item: Record<string, unknown>) => {
      const patch = extractDiffPatch(item);
      return {
        path: String(item.path ?? item.file),
        status: item.status === "added" || item.status === "deleted" ? item.status : "modified",
        additions: typeof item.additions === "number" ? item.additions : countPatchLines(patch, "+"),
        deletions: typeof item.deletions === "number" ? item.deletions : countPatchLines(patch, "-"),
        ...(patch ? { patch } : {}),
      };
    });
}

function extractDiffPatch(item: Record<string, unknown>): string | undefined {
  const candidates = [item.patch, item.diff, item.hunk, item.content, item.text];
  for (const candidate of candidates) {
    const patch = normalizePatchCandidate(candidate);
    if (patch) {
      return patch;
    }
  }

  if (Array.isArray(item.hunks)) {
    const hunks = item.hunks.map(normalizePatchCandidate).filter((hunk): hunk is string => Boolean(hunk));
    return hunks.length ? hunks.join("\n") : undefined;
  }

  return undefined;
}

function normalizePatchCandidate(candidate: unknown): string | undefined {
  if (typeof candidate === "string") {
    const trimmed = candidate.trimEnd();
    return trimmed ? trimmed : undefined;
  }

  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    return normalizePatchCandidate(record.patch ?? record.diff ?? record.text ?? record.content);
  }

  return undefined;
}

function countPatchLines(patch: string | undefined, marker: "+" | "-") {
  if (!patch) {
    return 0;
  }

  const ignoredPrefix = marker === "+" ? "+++" : "---";
  return patch.split(/\r?\n/u).filter((line) => line.startsWith(marker) && !line.startsWith(ignoredPrefix)).length;
}

function extractTextContent(content: any): string | null {
  if (!content) {
    return null;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => extractTextContent(item)).filter(Boolean).join("") || null;
  }

  if (content.type === "text" && typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.content === "string") {
    return content.content;
  }

  return null;
}

function normalizeSessionStatus(updateType: string | undefined): SessionStatus | null {
  switch (updateType) {
    case "completed":
    case "idle":
    case "session_idle":
      return "idle";
    case "running":
    case "started":
    case "session_running":
      return "running";
    case "cancelled":
    case "session_cancelled":
      return "cancelled";
    case "error":
    case "session_error":
      return "error";
    default:
      return null;
  }
}

function mapPermissionRequest(payload: any, fallbackSessionId: string, fallbackWorkspacePath: string) {
  const requestId = String(payload?.id ?? "");
  const params = payload?.params;
  const options = Array.isArray(params?.options) ? params.options : [];
  const toolCall = params?.toolCall ?? {};
  const allowOptionId = options.find((option: any) => /allow/iu.test(String(option?.kind ?? option?.name ?? option?.id ?? "")))?.id;
  const denyOptionId = options.find((option: any) => /reject|deny/iu.test(String(option?.kind ?? option?.name ?? option?.id ?? "")))?.id;
  if (!requestId || (!allowOptionId && !denyOptionId)) {
    return null;
  }

  const commandParts = [toolCall?.title, toolCall?.rawInput].filter((value) => typeof value === "string" && value.trim());
  const command = commandParts.join(" :: ") || "ACP permission request";
  const reasonParts = [params?.reason, toolCall?.kind, toolCall?.title].filter((value) => typeof value === "string" && value.trim());

  return {
    id: requestId,
    allowOptionId: typeof allowOptionId === "string" ? allowOptionId : undefined,
    denyOptionId: typeof denyOptionId === "string" ? denyOptionId : undefined,
    request: {
      id: requestId,
      command,
      reason: reasonParts.join(" · ") || "ACP agent requested permission.",
      workspacePath: typeof params?.cwd === "string" ? params.cwd : fallbackWorkspacePath,
    },
  };
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

export function normalizeProviderCleanupResult(result: ProviderCleanupResult) {
  switch (result.kind) {
    case "remote-deleted":
      return {
        remoteDeleted: true,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "remote-delete-failed":
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "unsupported":
    default:
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: false,
        providerId: result.providerId,
        message: result.message,
      };
  }
}

function sanitizeLogToken(value: string) {
  return value.replace(/[^a-z0-9._-]+/giu, "-");
}

// TODO(real-acp): introduce createAcpRuntime(provider, workspace) using stdio JSON-RPC notifications beyond initialize.
// TODO(real-acp): normalize ACP raw notifications into SessionRuntimeEvent here instead of leaking protocol details upward.









export { buildSessionLoadRequest, buildSessionNewRequest, buildSessionPromptRequest, buildSessionResumeRequest, buildSessionSetModelRequest, resolveRuntimeSessionId } from "./requests";
