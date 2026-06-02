import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { setImmediate as waitUntilNextEventLoopTurn } from "node:timers/promises";
import * as acp from "@agentclientprotocol/sdk";
import type { AcpAgentProvider, AgentPromptContent, PermissionDecision, SessionConfigOptionValue, SessionReasoningEffort, WorktreeSummary } from "@tiller/shared";
import { resolveAcpLaunchConfig } from "../adapters";
import { resolveSessionCapabilities, type DetectedAcpSessionCapabilities } from "../capabilities";
import { extractAcpModelState, extractSessionConfigOptions, findSessionConfigOptionId, hasSessionConfigOptionIdValue, hasSessionConfigOptionValue, mapSessionUpdateNotification, resolveCombinedSessionConfigState, resolveSessionConfigState, summarizeSessionUpdateNotification } from "../events";
import { createProtocolLogSink, writeChunkLog, writeLogLine, type AcpProtocolLoggingOptions, type ProtocolLogSink } from "../protocol-logging";
import { createProtocolStdoutStream, resolveLaunchSpec, terminateChildProcess } from "../process";
import { mapPromptContentToSdkBlocks, mapSdkPermissionRequest, mapTillerMcpServersToSdkMcpServers, SDK_RUNTIME_CLIENT_CAPABILITIES } from "../sdk-helpers";
import { resolveRuntimeSessionId } from "../requests";
import type { AcpSessionConfigOption, ProviderCleanupResult, SessionRuntimeEvent } from "../runtime-types";
import { resolveAcpConnectionKey } from "./key";
import { createConnectionClientMethods } from "./client-methods";
import { readConnectionTextFile, writeConnectionTextFile } from "./file-client";
import { withConnectionRequest } from "./request";
import {
  resolveRequestedRuntimeSessionId,
  updateSessionConfigOptionValue,
  updateSessionConfigOptionValueById,
} from "./session-config";
import type { AcpConnectionInventoryItem, AcpConnectionStatus } from "./types";
import { ConnectionTerminalClient } from "./terminal-client";

export type AcpConnectionOptions = {
  provider: AcpAgentProvider;
  worktree: WorktreeSummary;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: import("@tiller/shared").SessionReasoningEffort;
  };
  protocolLogging?: AcpProtocolLoggingOptions;
};

type AcpConnectionState = {
  provider: AcpAgentProvider;
  worktree: WorktreeSummary;
  launchCwd: string;
  sessionConfig?: AcpConnectionOptions["sessionConfig"];
  child: ChildProcess;
  agent: acp.ClientSideConnection;
  logFile?: string;
  protocolLog: ProtocolLogSink;
  capabilities: DetectedAcpSessionCapabilities;
  runtimeConnectionId: string;
};

export type OpenAcpSessionRequest = {
  tillerSessionId: string;
  worktree: WorktreeSummary;
  onEvent: (event: SessionRuntimeEvent) => void;
} & (
  | { kind: "new" }
  | { kind: "load"; runtimeSessionId: string }
  | { kind: "resume"; runtimeSessionId: string }
);

export type AcpSessionRuntimeHandle = {
  runtimeSessionId: string;
  sessionCapabilities: DetectedAcpSessionCapabilities;
  sessionConfigState: ReturnType<typeof resolveCombinedSessionConfigState>;
  sessionConfigOptions: AcpSessionConfigOption[];
  sessionModelState: ReturnType<typeof extractAcpModelState>;
  prompt: (text: string, content?: AgentPromptContent[]) => Promise<void>;
  configure: (nextConfig: { agentMode?: string; model?: string; reasoningEffort?: SessionReasoningEffort; configId?: string; value?: SessionConfigOptionValue }) => Promise<{
    runtimeApplied: boolean;
    state: ReturnType<typeof resolveCombinedSessionConfigState>;
    modelState: ReturnType<typeof extractAcpModelState>;
    options: AcpSessionConfigOption[];
  }>;
  respondPermission: (requestId: string, decision: PermissionDecision) => void;
  attachTillerSession: (sessionId: string) => void;
  deleteSession: () => Promise<ProviderCleanupResult>;
  close: () => Promise<ProviderCleanupResult>;
  cancel: () => void;
  supportsPermissionResponses: boolean;
};

type AcpSessionEntry = {
  runtimeSessionId: string;
  worktree: WorktreeSummary;
  onEvent: (event: SessionRuntimeEvent) => void;
  refCount: number;
  configOptions: AcpSessionConfigOption[];
  modelState: ReturnType<typeof extractAcpModelState>;
};

export class AcpConnection {
  private status: AcpConnectionStatus = "ready";
  private lastError: string | undefined;
  private readonly sessions = new Map<string, AcpSessionEntry>();
  private readonly pendingSessions = new Map<string, { promise: Promise<AcpSessionRuntimeHandle>; refCount: number }>();
  private readonly pendingPermissionReplies = new Map<string, {
    kind: "agent";
    optionIds: Partial<Record<PermissionDecision, string>>;
    allowOptionId?: string;
    denyOptionId?: string;
    resolve: (response: acp.RequestPermissionResponse) => void;
  } | { kind: "client"; resolve: (allowed: boolean) => void }>();
  private permissionRequestCounter = 0;
  private readonly terminalClient: ConnectionTerminalClient;
  private suppressExitError = false;

  private constructor(private readonly state: AcpConnectionState) {
    this.terminalClient = new ConnectionTerminalClient({
      resolveSession: (runtimeSessionId) => this.requireSessionByRuntimeId(runtimeSessionId),
      requestPermission: (sessionId, command, reason) => this.requestClientPermission(sessionId, command, reason),
    });
    this.state.child.once("exit", (code, signal) => {
      this.status = "closed";
      if (this.suppressExitError) {
        return;
      }
      if (code !== 0) {
        this.lastError = `ACP process exited with code=${code ?? "none"} signal=${signal ?? "none"}`;
        this.status = "error";
        this.broadcastExitError(this.lastError);
      }
    });
  }

  static async open(options: AcpConnectionOptions): Promise<AcpConnection> {
    const launchConfig = resolveAcpLaunchConfig(options.provider, {
      fallbackCwd: process.cwd(),
      sessionConfig: options.sessionConfig,
    });
    const launchSpec = resolveLaunchSpec(launchConfig.command, launchConfig.args);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...launchConfig.env };
    delete childEnv.NODE_OPTIONS;
    delete childEnv.TSX_TSCONFIG_PATH;
    delete childEnv.TSX_DISABLE_CACHE;

    const runtimeConnectionId = `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const protocolLog = createProtocolLogSink({
      mode: options.protocolLogging?.mode,
      logsDir: options.protocolLogging?.logsDir,
      filePrefix: "connection",
      token: runtimeConnectionId,
    });
    const logFile = protocolLog.logFile;
    const child = spawn(launchSpec.command, launchSpec.args, {
      cwd: launchConfig.cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderrBuffer = "";
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderrBuffer += text;
      writeChunkLog(protocolLog, "stderr", text);
    });

    let connection: AcpConnection | undefined;
    const protocolStdout = createProtocolStdoutStream(child.stdout, (line) => {
      protocolLog.writeLine("stdout-discarded", `Discarded non-JSON ACP stdout line (${line.length} chars)`);
    });
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(protocolStdout));
    const agent = new acp.ClientSideConnection(
      () => createConnectionClientMethods({
        onSessionUpdate: (params) => connection?.handleSessionUpdate(params),
        onRequestPermission: (params) => connection?.handleRequestPermission(params) ?? Promise.resolve({ outcome: { outcome: "cancelled" } }),
        readTextFile: (params) => connection?.readTextFile(params) ?? Promise.reject(new Error("ACP connection is not ready")),
        writeTextFile: (params) => connection?.writeTextFile(params) ?? Promise.reject(new Error("ACP connection is not ready")),
        createTerminal: (params) => connection?.createTerminal(params) ?? Promise.reject(new Error("ACP connection is not ready")),
        terminalOutput: (params) => connection?.terminalOutput(params) ?? Promise.reject(new Error("ACP connection is not ready")),
        waitForTerminalExit: (params) => connection?.waitForTerminalExit(params) ?? Promise.reject(new Error("ACP connection is not ready")),
        killTerminal: (params) => connection?.killTerminal(params) ?? Promise.reject(new Error("ACP connection is not ready")),
        releaseTerminal: (params) => connection?.releaseTerminal(params) ?? Promise.reject(new Error("ACP connection is not ready")),
      }),
      stream,
    );
    let initializeResult: Awaited<ReturnType<typeof agent.initialize>>;
    try {
      initializeResult = await withConnectionRequest(
        "initialize",
        agent.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: SDK_RUNTIME_CLIENT_CAPABILITIES,
          clientInfo: { name: "tiller", version: "0.1.0" },
        }),
        child,
        stderrBuffer,
        logFile,
        options.provider,
      );
    } catch (error) {
      terminateChildProcess(child.pid);
      throw error;
    }

    connection = new AcpConnection({
      provider: options.provider,
      worktree: options.worktree,
      launchCwd: launchConfig.cwd,
      sessionConfig: options.sessionConfig,
      child,
      agent,
      logFile,
      protocolLog,
      capabilities: resolveSessionCapabilities(initializeResult, options.provider),
      runtimeConnectionId,
    });
    return connection;
  }

  async openOrCreateSession(request: OpenAcpSessionRequest): Promise<AcpSessionRuntimeHandle> {
    const pending = this.pendingSessions.get(request.tillerSessionId);
    if (pending) {
      pending.refCount += 1;
      return pending.promise;
    }

    const existing = this.sessions.get(request.tillerSessionId);
    if (existing) {
      existing.refCount += 1;
      existing.worktree = request.worktree;
      existing.onEvent = request.onEvent;
      return this.createRuntimeHandle(request.tillerSessionId, existing);
    }

    this.sessions.set(request.tillerSessionId, {
      runtimeSessionId: resolveRequestedRuntimeSessionId(request),
      worktree: request.worktree,
      onEvent: request.onEvent,
      refCount: 1,
      configOptions: [],
      modelState: undefined,
    });

    const promise = this.openNewSession(request)
      .then((handle) => {
        const pendingRefCount = this.pendingSessions.get(request.tillerSessionId)?.refCount ?? 1;
        this.pendingSessions.delete(request.tillerSessionId);
        const entry = this.sessions.get(request.tillerSessionId);
        if (!entry) {
          throw new Error("session was closed before load completed");
        }
        entry.runtimeSessionId = handle.runtimeSessionId;
        entry.configOptions = handle.configOptions;
        entry.modelState = handle.modelState;
        entry.refCount = pendingRefCount;
        return this.createRuntimeHandle(request.tillerSessionId, entry);
      })
      .catch((error) => {
        this.pendingSessions.delete(request.tillerSessionId);
        this.sessions.delete(request.tillerSessionId);
        throw error;
      });

    this.pendingSessions.set(request.tillerSessionId, { promise, refCount: 1 });
    return promise;
  }

  async closeSession(tillerSessionId: string): Promise<ProviderCleanupResult> {
    const pending = this.pendingSessions.get(tillerSessionId);
    if (pending) {
      pending.refCount = Math.max(0, pending.refCount - 1);
      if (pending.refCount > 0) {
        return {
          kind: "remote-closed",
          providerId: this.state.provider.id,
          message: `${this.state.provider.name} session reference released: ${tillerSessionId}`,
        };
      }
      this.pendingSessions.delete(tillerSessionId);
      const runtimeSessionId = this.sessions.get(tillerSessionId)?.runtimeSessionId ?? tillerSessionId;
      this.sessions.delete(tillerSessionId);
      if (this.state.capabilities.sessionClose) {
        await this.closeRemoteSession(runtimeSessionId);
      }
      pending.promise.finally(() => this.disposeIfIdle()).catch(() => undefined);
      return {
        kind: this.state.capabilities.sessionClose ? "remote-closed" : "unsupported",
        providerId: this.state.provider.id,
        message: `${this.state.provider.name} remote session closed: ${runtimeSessionId}`,
      };
    }

    const session = this.sessions.get(tillerSessionId);
    if (!session) {
      return {
        kind: "unsupported",
        providerId: this.state.provider.id,
        message: `Session is not active: ${tillerSessionId}`,
      };
    }

    session.refCount = Math.max(0, session.refCount - 1);
    if (session.refCount > 0) {
      return {
        kind: "remote-closed",
        providerId: this.state.provider.id,
        message: `${this.state.provider.name} session reference released: ${session.runtimeSessionId}`,
      };
    }

    this.sessions.delete(tillerSessionId);
    if (this.state.capabilities.sessionClose) {
      await this.closeRemoteSession(session.runtimeSessionId);
    }
    this.disposeIfIdle();
    return {
      kind: this.state.capabilities.sessionClose ? "remote-closed" : "unsupported",
      providerId: this.state.provider.id,
      message: `${this.state.provider.name} remote session closed: ${session.runtimeSessionId}`,
    };
  }

  private createRuntimeHandle(tillerSessionId: string, entry: AcpSessionEntry): AcpSessionRuntimeHandle {
    const state = () => resolveCombinedSessionConfigState(entry.configOptions, entry.modelState);
    let activeTillerSessionId = tillerSessionId;
    return {
      runtimeSessionId: entry.runtimeSessionId,
      sessionCapabilities: this.state.capabilities,
      sessionConfigState: state(),
      sessionConfigOptions: entry.configOptions,
      sessionModelState: entry.modelState,
      prompt: (text, content) => this.promptSession(activeTillerSessionId, text, content),
      configure: (nextConfig) => this.configureSession(activeTillerSessionId, nextConfig),
      respondPermission: (requestId, decision) => this.respondPermission(requestId, decision),
      attachTillerSession: (sessionId) => {
        if (sessionId === activeTillerSessionId) {
          return;
        }
        if (this.sessions.get(activeTillerSessionId) === entry) {
          this.sessions.delete(activeTillerSessionId);
        }
        this.sessions.set(sessionId, entry);
        activeTillerSessionId = sessionId;
      },
      deleteSession: async () => ({
        kind: "unsupported",
        providerId: this.state.provider.id,
        message: `${this.state.provider.name} does not advertise ACP session/delete in shared connection runtime yet.`,
      }),
      close: () => this.closeSession(activeTillerSessionId),
      cancel: () => this.cancelSession(activeTillerSessionId),
      supportsPermissionResponses: true,
    };
  }

  private async configureSession(
    tillerSessionId: string,
    nextConfig: { agentMode?: string; model?: string; reasoningEffort?: SessionReasoningEffort; configId?: string; value?: SessionConfigOptionValue },
  ): Promise<{ runtimeApplied: boolean; state: ReturnType<typeof resolveCombinedSessionConfigState>; modelState: ReturnType<typeof extractAcpModelState>; options: AcpSessionConfigOption[] }> {
    const session = this.sessions.get(tillerSessionId);
    if (!session) {
      return { runtimeApplied: false, state: {}, modelState: undefined, options: [] };
    }
    let runtimeApplied = false;
    const applyConfigOption = async (configId: string | undefined, value: SessionConfigOptionValue | undefined) => {
      if (!configId || typeof value === "undefined" || !hasSessionConfigOptionIdValue(session.configOptions, configId, value)) {
        return false;
      }
      const setConfigOptionRequest =
        typeof value === "boolean"
          ? { sessionId: session.runtimeSessionId, configId, type: "boolean" as const, value }
          : { sessionId: session.runtimeSessionId, configId, value };
      const result = await withConnectionRequest(
        "session/set_config_option",
        this.state.agent.setSessionConfigOption(setConfigOptionRequest as any),
        this.state.child,
        "",
        this.state.logFile,
        this.state.provider,
      );
      const nextOptions = extractSessionConfigOptions(result);
      if (nextOptions.length) {
        session.configOptions = nextOptions;
      } else {
        session.configOptions = updateSessionConfigOptionValueById(session.configOptions, configId, value);
      }
      session.onEvent({ type: "config-options", state: resolveSessionConfigState(session.configOptions), options: session.configOptions });
      runtimeApplied = true;
      return true;
    };
    const applyOption = async (category: "mode" | "model" | "thought_level", value: string | undefined) => {
      if (!value || !hasSessionConfigOptionValue(session.configOptions, category, value)) {
        return false;
      }
      const optionId = findSessionConfigOptionId(session.configOptions, category);
      if (!optionId) {
        return false;
      }
      return applyConfigOption(optionId, value);
    };

    const directConfigApplied = await applyConfigOption(nextConfig.configId, nextConfig.value);

    let modeAppliedAsSdk = false;
    if (!directConfigApplied && nextConfig.agentMode) {
      try {
        await withConnectionRequest(
          "session/set_mode",
          this.state.agent.setSessionMode({ sessionId: session.runtimeSessionId, modeId: nextConfig.agentMode }),
          this.state.child,
          "",
          this.state.logFile,
          this.state.provider,
        );
        session.configOptions = updateSessionConfigOptionValue(session.configOptions, "mode", nextConfig.agentMode);
        session.onEvent({ type: "config-options", state: resolveSessionConfigState(session.configOptions), options: session.configOptions });
        runtimeApplied = true;
        modeAppliedAsSdk = true;
      } catch {
        modeAppliedAsSdk = false;
      }
    }
    if (!modeAppliedAsSdk) {
      await applyOption("mode", directConfigApplied ? undefined : nextConfig.agentMode);
    }
    const modelAppliedAsConfig = directConfigApplied ? false : await applyOption("model", nextConfig.model);
    if (!modelAppliedAsConfig && nextConfig.model && session.modelState?.options.some((model) => model.id === nextConfig.model)) {
      await withConnectionRequest(
        "session/set_model",
        this.state.agent.unstable_setSessionModel({ sessionId: session.runtimeSessionId, modelId: nextConfig.model }),
        this.state.child,
        "",
        this.state.logFile,
        this.state.provider,
      );
      session.modelState = { ...session.modelState, currentModelId: nextConfig.model };
      session.onEvent({ type: "model-options", state: session.modelState });
      runtimeApplied = true;
    }
    await applyOption("thought_level", directConfigApplied ? undefined : nextConfig.reasoningEffort);

    return {
      runtimeApplied,
      state: resolveCombinedSessionConfigState(session.configOptions, session.modelState),
      modelState: session.modelState,
      options: session.configOptions,
    };
  }

  private async promptSession(tillerSessionId: string, text: string, content?: AgentPromptContent[]): Promise<void> {
    const session = this.sessions.get(tillerSessionId);
    if (!session) {
      throw new Error(`Session is not active: ${tillerSessionId}`);
    }
    const promptContent = content?.length ? content : [{ type: "text" as const, text }];
    session.onEvent({ type: "status", status: "running", message: "ACP agent is responding" });
    try {
      await withConnectionRequest(
        "session/prompt",
        this.state.agent.prompt({ sessionId: session.runtimeSessionId, prompt: mapPromptContentToSdkBlocks(promptContent) }),
        this.state.child,
        "",
        this.state.logFile,
        this.state.provider,
      );
      await waitUntilNextEventLoopTurn();
      session.onEvent({ type: "status", status: "idle", message: "ACP prompt completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send ACP prompt.";
    writeLogLine(this.state.logFile, "sdk-error", message);
      if (/ACP connection closed/iu.test(message)) {
        this.status = "error";
        this.lastError = message;
      }
      session.onEvent({
        type: "error",
        code: "ACP_PROMPT_FAILED",
        message,
      });
      session.onEvent({ type: "status", status: "error", message: "ACP prompt failed" });
    }
  }

  private cancelSession(tillerSessionId: string): void {
    const session = this.sessions.get(tillerSessionId);
    if (!session) {
      return;
    }
    void this.state.agent.cancel({ sessionId: session.runtimeSessionId })
      .catch(() => undefined)
      .finally(() => {
        this.sessions.delete(tillerSessionId);
        this.disposeIfIdle();
      });
    session.onEvent({ type: "status", status: "cancelled", message: "Cancelled by remote operator" });
  }

  private disposeIfIdle(): void {
    if (this.sessions.size || this.pendingSessions.size) {
      return;
    }
    // ACP connections are intentionally persistent: idle children stay alive
    // until manual reconnect/close, provider crash, or Helm shutdown.
  }

  private async closeRemoteSession(runtimeSessionId: string): Promise<void> {
    await withConnectionRequest(
      "session/close",
      this.state.agent.closeSession({ sessionId: runtimeSessionId }),
      this.state.child,
      "",
      this.state.logFile,
      this.state.provider,
    );
  }

  private async openNewSession(request: OpenAcpSessionRequest): Promise<{ runtimeSessionId: string; configOptions: AcpSessionConfigOption[]; modelState: ReturnType<typeof extractAcpModelState> }> {
    if (request.kind === "load") {
      const result = await withConnectionRequest(
        "session/load",
        this.state.agent.loadSession({
          sessionId: request.runtimeSessionId,
          cwd: request.worktree.path,
          mcpServers: mapTillerMcpServersToSdkMcpServers(this.state.provider.mcpServers ?? []),
        }),
        this.state.child,
        "",
        this.state.logFile,
        this.state.provider,
      );
      return {
        runtimeSessionId: resolveRuntimeSessionId(result, request.runtimeSessionId),
        configOptions: extractSessionConfigOptions(result),
        modelState: extractAcpModelState(result),
      };
    }

    if (request.kind === "resume") {
      const result = await withConnectionRequest(
        "session/resume",
        this.state.agent.resumeSession({
          sessionId: request.runtimeSessionId,
          cwd: request.worktree.path,
          mcpServers: mapTillerMcpServersToSdkMcpServers(this.state.provider.mcpServers ?? []),
        }),
        this.state.child,
        "",
        this.state.logFile,
        this.state.provider,
      );
      return {
        runtimeSessionId: resolveRuntimeSessionId(result, request.runtimeSessionId),
        configOptions: extractSessionConfigOptions(result),
        modelState: extractAcpModelState(result),
      };
    }

    const result = await withConnectionRequest(
      "session/new",
      this.state.agent.newSession({
        cwd: request.worktree.path,
        mcpServers: mapTillerMcpServersToSdkMcpServers(this.state.provider.mcpServers ?? []),
      }),
      this.state.child,
      "",
      this.state.logFile,
      this.state.provider,
    );
    return {
      runtimeSessionId: resolveRuntimeSessionId(result, request.tillerSessionId),
      configOptions: extractSessionConfigOptions(result),
      modelState: extractAcpModelState(result),
    };
  }

  private respondPermission(requestId: string, decision: PermissionDecision): void {
    const pending = this.pendingPermissionReplies.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingPermissionReplies.delete(requestId);
    const allowed = decision.startsWith("allow");
    if (pending.kind === "client") {
      pending.resolve(allowed);
      return;
    }
    const optionId = pending.optionIds[decision]
      ?? (allowed ? pending.allowOptionId : pending.denyOptionId);
    pending.resolve(optionId
      ? { outcome: { outcome: "selected", optionId } }
      : { outcome: { outcome: "cancelled" } });
  }

  private async handleRequestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const session = this.findSessionByRuntimeId(params.sessionId);
    const mapped = mapSdkPermissionRequest(params, this.nextPermissionRequestId("sdk-permission"), session?.worktree.path ?? this.state.launchCwd);
    session?.onEvent({ type: "status", status: "waiting_for_permission", message: "ACP agent requested permission" });
    session?.onEvent({ type: "permission-request", request: mapped.request });
    return await new Promise<acp.RequestPermissionResponse>((resolve) => {
      this.pendingPermissionReplies.set(mapped.id, {
        kind: "agent",
        optionIds: mapped.optionIds,
        allowOptionId: mapped.allowOptionId,
        denyOptionId: mapped.denyOptionId,
        resolve,
      });
    });
  }

  private async readTextFile(params: any): Promise<{ content: string }> {
    return await readConnectionTextFile({
      session: this.requireSessionByRuntimeId(params.sessionId),
      path: params.path,
      line: params.line,
      limit: params.limit,
    });
  }

  private async writeTextFile(params: any): Promise<Record<string, never>> {
    return await writeConnectionTextFile({
      sessionId: params.sessionId,
      session: this.requireSessionByRuntimeId(params.sessionId),
      path: params.path,
      content: params.content,
      requestPermission: (sessionId, command, reason) => this.requestClientPermission(sessionId, command, reason),
    });
  }

  private async createTerminal(params: any): Promise<{ terminalId: string }> {
    return await this.terminalClient.create(params);
  }

  private async terminalOutput(params: any) {
    return await this.terminalClient.output(params);
  }

  private async waitForTerminalExit(params: any) {
    return await this.terminalClient.waitForExit(params);
  }

  private async killTerminal(params: any) {
    return await this.terminalClient.kill(params);
  }

  private async releaseTerminal(params: any) {
    return await this.terminalClient.release(params);
  }

  private async requestClientPermission(sessionId: string, command: string, reason: string): Promise<boolean> {
    const session = this.findSessionByRuntimeId(sessionId);
    const id = this.nextPermissionRequestId("sdk-client-permission");
    session?.onEvent({ type: "status", status: "waiting_for_permission", message: reason });
    session?.onEvent({
      type: "permission-request",
      request: { id, command, reason, cwd: session?.worktree.path ?? this.state.launchCwd },
    });
    return await new Promise<boolean>((resolve) => {
      this.pendingPermissionReplies.set(id, { kind: "client", resolve });
    });
  }

  private nextPermissionRequestId(prefix: string): string {
    this.permissionRequestCounter += 1;
    return `${prefix}-${this.permissionRequestCounter}`;
  }

  private findSessionByRuntimeId(runtimeSessionId: string): AcpSessionEntry | undefined {
    return Array.from(this.sessions.values()).find((session) => session.runtimeSessionId === runtimeSessionId);
  }

  private requireSessionByRuntimeId(runtimeSessionId: string): AcpSessionEntry {
    const session = this.findSessionByRuntimeId(runtimeSessionId);
    if (!session) {
      throw new Error(`ACP client request targeted unknown session ${runtimeSessionId}.`);
    }
    return session;
  }

  private broadcastExitError(message: string): void {
    for (const session of this.sessions.values()) {
      session.onEvent({ type: "error", message, code: "ACP_CONNECTION_EXITED" });
      session.onEvent({ type: "status", status: "error", message });
    }
  }

  private handleSessionUpdate(params: unknown): void {
    const mapped = mapSessionUpdateNotification(
      { method: "session/update", params },
      { providerId: this.state.provider.id },
    );
    writeLogLine(
      this.state.logFile,
      "session-update",
      JSON.stringify(summarizeSessionUpdateNotification(params, mapped?.event.type)),
    );
    if (!mapped) {
      return;
    }
    for (const session of this.sessions.values()) {
      if (session.runtimeSessionId === mapped.sessionId) {
        session.onEvent(mapped.event);
        return;
      }
    }
  }

  inventory(): AcpConnectionInventoryItem {
    return {
      key: resolveAcpConnectionKey({
        provider: this.state.provider,
        worktree: this.state.worktree,
        sessionConfig: this.state.sessionConfig,
      }),
      providerId: this.state.provider.id,
      cwd: this.state.worktree.path,
      worktreeName: this.state.worktree.name,
      launchCwd: this.state.launchCwd,
      status: this.status,
      runtimeConnectionId: this.state.runtimeConnectionId,
      initialized: true,
      activeSessionCount: this.sessions.size,
      pendingSessionCount: this.pendingSessions.size,
      sessions: Array.from(this.sessions.entries()).map(([tillerSessionId, session]) => ({
        tillerSessionId,
        runtimeSessionId: session.runtimeSessionId,
        worktreeName: session.worktree.name,
        cwd: session.worktree.path,
      })),
      capabilities: this.state.capabilities,
      pid: this.state.child.pid,
      lastError: this.lastError,
    };
  }

  async dispose(): Promise<void> {
    this.status = "closed";
    this.suppressExitError = true;
    if (this.state.child.pid) {
      terminateChildProcess(this.state.child.pid);
    }
  }
}
