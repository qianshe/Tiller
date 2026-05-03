import type { AcpModelOption, AcpModelState, AgentToolCall, AvailableCommand, CommandChunk, FileDiffSummary, PermissionRequest, SessionReasoningEffort, SessionStatus } from "@tiller/shared";
import type { AcpSessionConfigOption, AcpSessionConfigState, ProviderCleanupResult, SessionRuntimeEvent } from "./runtime";

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
  models?: AcpProtocolSessionModelState | null;
};

function timestamp() {
  return new Date().toISOString();
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

  if (text && (updateType === "agent_message_chunk" || updateType === "user_message_chunk")) {
    return {
      sessionId,
      event: {
        type: "message",
        message: {
          id: resolveMessageId(sessionId, update),
          role: updateType === "user_message_chunk" ? "user" : "assistant",
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

  if (updateType === "available_commands_update") {
    const rawCommands = Array.isArray(update.availableCommands) ? update.availableCommands : [];
    const commands: AvailableCommand[] = rawCommands
      .filter((cmd: any) => cmd && typeof cmd.name === "string")
      .map((cmd: any) => ({
        name: cmd.name,
        description: typeof cmd.description === "string" ? cmd.description : undefined,
        input: cmd.input && typeof cmd.input === "object" ? { hint: typeof cmd.input.hint === "string" ? cmd.input.hint : undefined } : undefined,
      }));
    return {
      sessionId,
      event: {
        type: "available-commands",
        commands,
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

export function extractSessionConfigOptions(payload: any): AcpSessionConfigOption[] {
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

export function extractAcpModelState(payload: AcpSessionResponseWithModels | any): AcpModelState | undefined {
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

export function resolveCombinedSessionConfigState(configOptions: AcpSessionConfigOption[], modelState?: AcpModelState): AcpSessionConfigState {
  const state = resolveSessionConfigState(configOptions);
  return {
    ...state,
    ...(!state.model && modelState?.currentModelId ? { model: modelState.currentModelId } : {}),
  };
}

export function hasSessionConfigOptionValue(configOptions: AcpSessionConfigOption[], category: string, value: string) {
  const option = configOptions.find((item) => item.category?.toLowerCase() === category);
  if (!option) {
    return false;
  }

  const candidates = [option.currentValue, option.selectedValue, option.value, ...(option.options ?? []).map((item) => item.value)];
  return candidates.some((candidate) => candidate === value);
}

export function hasOpenCodePortArg(args: string[]) {
  return args.some((value, index) => value === "--port" || value.startsWith("--port=") || args[index - 1] === "--port");
}

export function resolveSessionConfigState(configOptions: AcpSessionConfigOption[]): AcpSessionConfigState {
  const state: AcpSessionConfigState = {};
  const agentModeValue = readSessionConfigValue(configOptions, "mode");
  if (typeof agentModeValue === "string" && agentModeValue) {
    state.agentMode = agentModeValue;
  }

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

export function findSessionConfigOptionId(configOptions: AcpSessionConfigOption[], category: string) {
  return configOptions.find((item) => item.category?.toLowerCase() === category)?.id;
}

function extractToolCall(sessionId: string, updateType: string | undefined, update: any): AgentToolCall | null {
  const type = updateType ?? "";
  if (!/(tool|terminal)/iu.test(type) || /command_output/iu.test(type)) {
    return null;
  }

  const source = update.toolCall ?? update.tool_call ?? update.tool ?? update.terminal ?? update;
  const id = stringFrom(source.id ?? source.toolCallId ?? source.tool_call_id ?? source.callId ?? update.id) ?? `${sessionId}-tool-${Date.now()}`;
  const commandId = stringFrom(source.commandId ?? source.command_id ?? source.terminalId ?? update.commandId);
  const toolName = extractToolName(source, update);
  const rawTitle = stringFrom(source.title ?? source.label ?? source.displayName ?? source.display_name ?? source.name ?? source.toolName ?? source.tool_name ?? source.tool ?? source.command);
  const title = resolveToolTitle(rawTitle, toolName, commandId, id);
  const output = stringifyToolPayload(source.output ?? source.result ?? source.rawOutput ?? source.raw_output ?? source.content ?? source.text ?? source.state?.output);
  const input = stringifyToolPayload(source.input ?? source.arguments ?? source.args ?? source.params ?? source.command ?? source.rawInput ?? source.raw_input ?? source.state?.input);
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


function resolveToolTitle(rawTitle: string | undefined, toolName: string | undefined, commandId: string | undefined, id: string) {
  if (isInformativeToolTitle(rawTitle, id)) {
    return rawTitle!;
  }
  if (isInformativeToolTitle(toolName, id)) {
    return toolName!.includes(":") ? toolName! : `Tool: ${toolName}`;
  }
  return commandId ?? rawTitle ?? id;
}

function extractToolName(source: any, update: any) {
  return (
    toolNameFromRawInput(source.rawInput ?? source.raw_input ?? update.rawInput ?? update.raw_input) ??
    primitiveStringFrom(
      source.toolName ??
      source.tool_name ??
      source.name ??
      source.tool ??
      source.function?.name ??
      source.input?.name ??
      source.input?.tool ??
      source.input?.toolName ??
      source.input?.tool_name ??
      source.arguments?.name ??
      source.args?.name ??
      update.toolName ??
      update.tool_name,
    )
  );
}

function toolNameFromRawInput(rawInput: unknown) {
  if (!rawInput || typeof rawInput !== "object") {
    return undefined;
  }
  const record = rawInput as Record<string, unknown>;
  const server = primitiveStringFrom(record.server);
  const tool = primitiveStringFrom(record.tool ?? record.name ?? record.toolName ?? record.tool_name);
  if (server && tool) {
    return `${server}/${tool}`;
  }
  return tool ?? server;
}

function stringifyToolPayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isInformativeToolTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function primitiveStringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
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

function resolveMessageId(sessionId: string, update: any) {
  return stringFrom(update.messageId ?? update.message_id ?? update.message?.id ?? update.id) ?? `${sessionId}-msg-${Date.now()}`;
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

  return extractTextContent(content.content) ?? null;
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
    case "remote-closed":
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "remote-close-failed":
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

