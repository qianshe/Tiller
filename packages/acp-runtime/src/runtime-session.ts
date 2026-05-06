import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { resolve } from "node:path";
import { ACP_EARLY_STDERR_FAILURE, ACP_INITIALIZE_TIMEOUT_MS, DEFAULT_ACP_PROMPT_TIMEOUT_MS, DEFAULT_ACP_REQUEST_TIMEOUT_MS } from "./constants";
import { resolveSessionCapabilities } from "./capabilities";
import { resolveLaunchSpec, terminateChildProcess } from "./process";
import { ACP_LOGS_DIR, sanitizeLogToken, writeChunkLog, writeLogLine, writeProtocolLog } from "./protocol-logging";
import { resolveAcpLaunchConfig } from "./adapters";
import { extractAcpModelState, extractSessionConfigOptions, findSessionConfigOptionId, hasSessionConfigOptionValue, mapSessionUpdateNotification, resolveCombinedSessionConfigState, resolveSessionConfigState } from "./events";
import { resolveRuntimeSessionId } from "./requests";
import { createRuntimeClientMethods, type AcpRuntimePendingPermissionReply } from "./runtime-client-methods";
import { SDK_RUNTIME_CLIENT_CAPABILITIES, mapPromptContentToSdkBlocks, mapTillerMcpServersToSdkMcpServers } from "./sdk-helpers";
import type { ManagedSdkTerminal } from "./terminal-client";
import {
  ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
  ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
} from "@tiller/shared";
import type {
  AcpModelState,
  AgentPromptContent,
  PermissionDecision,
  SessionReasoningEffort,
} from "@tiller/shared";
import type { AcpRuntimeOptions, AcpSessionConfigOption } from "./runtime-types";

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
  const pendingPermissionReplies = new Map<string, AcpRuntimePendingPermissionReply>();
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

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const agent = new acp.ClientSideConnection(() => createRuntimeClientMethods({
    options,
    launchCwd,
    childEnv,
    logFile,
    terminals,
    pendingPermissionReplies,
    getSessionToken: () => sessionToken,
    setCurrentConfigOptions: (options) => {
      currentConfigOptions = options;
    },
    nextPermissionRequestId: (prefix) => {
      permissionRequestCounter += 1;
      return `${prefix}-${permissionRequestCounter}`;
    },
    nextTerminalId: () => {
      terminalCounter += 1;
      return `sdk-terminal-${terminalCounter}`;
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
    const isAllowed = decision.startsWith("allow");
    if (pendingPermission.kind === "client") {
      pendingPermission.resolve(isAllowed);
      options.onEvent({
        type: "status",
        status: isAllowed ? "running" : "idle",
        message: isAllowed ? "Client operation permission granted" : "Client operation permission denied",
      });
      return;
    }

    const optionId = pendingPermission.optionIds[decision]
      ?? (decision === "allow" ? pendingPermission.allowOptionId : undefined)
      ?? (decision === "deny" ? pendingPermission.denyOptionId : undefined);
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
