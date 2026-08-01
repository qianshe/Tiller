import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";
import { extractCodexSkillNameFromText, formatCodexSkillTitle } from "./skill-tools";

const CODEX_SUBAGENT_TOOL_TITLE = /^spawn_agents_/u;
const CODEX_MULTI_AGENT_TOOL_TITLE = /^(?:spawn_agent|send_message|send_input|followup_task|wait_agent|interrupt_agent|list_agents|close_agent|resume_agent)$/u;
const CODEX_SPARSE_LIFECYCLE_TOOL_TITLE = /^(?:spawn_agent|wait_agent|close_agent)$/u;
const CODEX_MULTI_AGENT_NAMESPACE = "multi_agent_v1";
const CODEX_WEB_NAMESPACE = "web";
const CODEX_APP_SERVER_TOOL_NAMES: Record<string, string> = {
  spawnAgent: "spawn_agent",
  sendMessage: "send_message",
  sendInput: "send_input",
  followupTask: "followup_task",
  waitAgent: "wait_agent",
  interruptAgent: "interrupt_agent",
  listAgents: "list_agents",
  closeAgent: "close_agent",
  resumeAgent: "resume_agent",
};

export type CodexSubagentActivityKind = "started" | "interacted" | "interrupted";

export type CodexSubagentActivity = {
  kind: CodexSubagentActivityKind;
  threadId?: string;
  path?: string;
};

type CodexToolCallNormalizationContext = {
  toolCall: AgentToolCall;
  input: Record<string, unknown> | null;
  descriptor: CodexToolDescriptor | null;
  activity: CodexSubagentActivity | null;
  update: any;
};

type CodexToolCallRule = {
  match(context: CodexToolCallNormalizationContext): boolean;
  normalize(context: CodexToolCallNormalizationContext): AgentToolCall;
};

const CODEX_TOOL_CALL_RULES: CodexToolCallRule[] = [
  {
    match: ({ toolCall, input, descriptor, activity }) =>
      looksLikeCodexSubagentToolCall(toolCall, input, descriptor, activity),
    normalize: ({ toolCall, input, descriptor, activity }) => {
      const toolName = resolveCodexMultiAgentToolName(toolCall.title, input, descriptor);
      const operation = activity
        ? resolveCodexSubagentActivityOperation(activity, toolCall.id)
        : resolveCodexSubagentOperation(toolName, input, toolCall.id);
      const commandId = activity
        ? resolveCodexSubagentActivityCommandId(activity, toolCall.id)
        : resolveCodexSubagentCommandId(toolName, input, toolCall.id);
      return {
        ...toolCall,
        kind: "subagent" as const,
        title: "Subagent",
        ...(commandId ? { commandId } : {}),
        ...(operation ? { subagentOperation: operation } : {}),
      };
    },
  },
  {
    match: ({ toolCall, input }) => Boolean(extractCodexSkillNameFromToolCall(toolCall, input)),
    normalize: ({ toolCall, input }) => {
      const { input: _input, output: _output, ...summary } = toolCall;
      return {
        ...summary,
        kind: "skill" as const,
        title: formatCodexSkillTitle(extractCodexSkillNameFromToolCall(toolCall, input)!),
      };
    },
  },
  {
    match: ({ toolCall, input, update }) =>
      toolCall.kind === "write" &&
      isGenericCodexWriteTitle(toolCall.title) &&
      resolveCodexWritePaths(input, update).length > 0,
    normalize: ({ toolCall, input, update }) => ({
      ...toolCall,
      title: formatCodexWriteTitle(resolveCodexWritePaths(input, update)),
    }),
  },
  {
    match: ({ toolCall, input, descriptor }) => Boolean(resolveCodexMcp(toolCall, input, descriptor)),
    normalize: ({ toolCall, input, descriptor }) => {
      const mcp = resolveCodexMcp(toolCall, input, descriptor);
      return mcp
        ? {
            ...toolCall,
            kind: "mcp" as const,
            title: formatAgentToolCallMcpTitle(mcp),
            mcp,
          }
        : toolCall;
    },
  },
  {
    match: ({ toolCall, input, descriptor }) =>
      descriptor?.namespace === CODEX_WEB_NAMESPACE ||
      descriptor?.qualifiedName === "web.run" ||
      looksLikeCodexWebFetchToolCall(toolCall, input),
    normalize: ({ toolCall, descriptor }) => ({
      ...toolCall,
      kind: "fetch" as const,
      ...(descriptor && isGenericCodexWebTitle(toolCall.title)
        ? {
            title: isCodexInputStreaming(toolCall.status)
              ? "Searching the Web"
              : resolveCodexWebToolTitle(descriptor),
          }
        : {}),
    }),
  },
  {
    match: ({ input }) => looksLikeCodexShellPayload(input),
    normalize: ({ toolCall }) => ({
      ...toolCall,
      kind: "shell" as const,
      ...(isCodexInputStreaming(toolCall.status) ? { title: "Shell" } : {}),
    }),
  },
];

export function normalizeCodexToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const input = resolveNormalizedCodexToolInput(toolCall, update);
  const descriptor = resolveCodexToolDescriptor(input);
  const activity = resolveCodexSubagentActivity(input, update);
  const context: CodexToolCallNormalizationContext = {
    toolCall,
    input,
    descriptor,
    activity,
    update,
  };
  for (const rule of CODEX_TOOL_CALL_RULES) {
    if (rule.match(context)) {
      return rule.normalize(context);
    }
  }
  return toolCall;
}

function resolveCodexWritePaths(
  input: Record<string, unknown> | null,
  update: any,
) {
  const paths: string[] = [];
  const seen = new Set<string>();
  const addPath = (value: unknown) => {
    const path = stringValue(value);
    if (!path) {
      return;
    }
    const identity = path.replace(/\\/gu, "/");
    if (!seen.has(identity)) {
      seen.add(identity);
      paths.push(path);
    }
  };

  for (const source of [update, update?.toolCall, update?.tool_call]) {
    collectCodexPathsFromContent(source?.content, addPath);
    collectCodexPathsFromLocations(source?.locations, addPath);
  }
  collectCodexPathsFromChanges(input?.changes, addPath);
  return paths;
}

function collectCodexPathsFromContent(
  content: unknown,
  addPath: (value: unknown) => void,
) {
  if (!Array.isArray(content)) {
    return;
  }
  for (const item of content) {
    const record = recordValue(item);
    if (!record) {
      continue;
    }
    if (record.type === "diff") {
      addPath(record.path);
    }
  }
}

function collectCodexPathsFromLocations(
  locations: unknown,
  addPath: (value: unknown) => void,
) {
  if (!Array.isArray(locations)) {
    return;
  }
  for (const location of locations) {
    addPath(recordValue(location)?.path);
  }
}

function collectCodexPathsFromChanges(
  changes: unknown,
  addPath: (value: unknown) => void,
) {
  if (Array.isArray(changes)) {
    for (const change of changes) {
      const record = recordValue(change);
      addPath(record?.path ?? record?.file_path ?? record?.filePath);
    }
    return;
  }
  const record = recordValue(changes);
  if (!record) {
    return;
  }
  const directPath = record.path ?? record.file_path ?? record.filePath;
  if (directPath) {
    addPath(directPath);
    return;
  }
  for (const [path, change] of Object.entries(record)) {
    if (looksLikeCodexFileChange(change)) {
      addPath(path);
    }
  }
}

function looksLikeCodexFileChange(value: unknown) {
  const record = recordValue(value);
  return Boolean(
    record &&
    (record.type === "add" ||
      record.type === "delete" ||
      record.type === "update" ||
      record.kind ||
      record.unified_diff),
  );
}

function isGenericCodexWriteTitle(title: string) {
  const normalized = title.trim();
  return isOpaqueCodexToolTitle(title) ||
    /^(?:Edit|Editing files?|Write|Writing files?)$/iu.test(normalized);
}

function formatCodexWriteTitle(paths: string[]) {
  const firstPath = compactCodexWritePath(paths[0]!);
  return paths.length === 1 ? firstPath : `${firstPath} (+${paths.length - 1} more)`;
}

function compactCodexWritePath(path: string) {
  return path.match(/(?:^|[\\/])((?:apps|packages|docs|scripts)[\\/].*)$/u)?.[1] ?? path;
}

function resolveCodexWebToolTitle(descriptor: CodexToolDescriptor) {
  const query = firstString(
    descriptor.arguments?.query,
    descriptor.arguments?.search_query,
    descriptor.arguments?.searchQuery,
  );
  return query ? `Searching for: ${query}` : "Searching the Web";
}

function isCodexInputStreaming(status: AgentToolCall["status"]) {
  return status === "pending" || status === "running";
}

function looksLikeCodexSubagentToolCall(
  toolCall: AgentToolCall,
  input: Record<string, unknown> | null,
  descriptor: CodexToolDescriptor | null,
  activity: CodexSubagentActivity | null = null,
) {
  if (activity) {
    return true;
  }
  const toolName = resolveCodexMultiAgentToolName(toolCall.title, input, descriptor);
  if (toolName && (isCodexMultiAgentToolName(toolName) || isCodexMultiAgentNamespace(input))) {
    return true;
  }
  return looksLikeCodexSubagentPayload(toolCall.title, input);
}


export function looksLikeCodexSubagentPayload(
  title: string,
  input: Record<string, unknown> | null,
) {
  const normalizedTitle = title.trim();
  const normalizedInput = mergeCodexToolArguments(input);
  if (!normalizedInput) {
    return Boolean(resolveSparseCodexLifecycleToolName(normalizedTitle));
  }
  const toolName = resolveCodexMultiAgentToolName(normalizedTitle, normalizedInput);
  if (toolName && (isCodexMultiAgentToolName(toolName) || isCodexMultiAgentNamespace(normalizedInput))) {
    return true;
  }
  if (
    !CODEX_SUBAGENT_TOOL_TITLE.test(normalizedTitle) &&
    !CODEX_MULTI_AGENT_TOOL_TITLE.test(normalizedTitle)
  ) {
    return false;
  }
  if (typeof normalizedInput.path === "string" && normalizedInput.path.trim()) {
    return true;
  }
  if (
    Array.isArray(normalizedInput.targets) &&
    normalizedInput.targets.some((item) => typeof item === "string" && item.trim())
  ) {
    return true;
  }
  if (typeof normalizedInput.target === "string" && normalizedInput.target.trim()) {
    return true;
  }
  if (typeof normalizedInput.message === "string" && normalizedInput.message.trim()) {
    return true;
  }
  return normalizedInput.fork_context === true || normalizedInput.forkContext === true;
}

function parseJsonRecord(input: string | undefined) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

type CodexToolDescriptor = {
  namespace?: string;
  name?: string;
  qualifiedName?: string;
  arguments: Record<string, unknown> | null;
};

function resolveCodexToolDescriptor(input: Record<string, unknown> | null): CodexToolDescriptor | null {
  if (!input) {
    return null;
  }
  const namespace = stringValue(input.namespace ?? input.tool_namespace);
  const name = stringValue(input.name ?? input.toolName ?? input.tool_name ?? input.tool);
  const argumentsInput = parseJsonRecordValue(input.arguments ?? input.args ?? input.params ?? input.input);
  return {
    ...(namespace ? { namespace } : {}),
    ...(name ? { name } : {}),
    ...(namespace && name ? { qualifiedName: `${namespace}.${name}` } : {}),
    arguments: argumentsInput,
  };
}

function resolveNormalizedCodexToolInput(
  toolCall: AgentToolCall,
  update: any,
) {
  return mergeCodexInputSources([
    parseJsonRecord(toolCall.input),
    parseJsonRecord(toolCall.output),
    parseJsonRecordValue(update?.rawInput ?? update?.raw_input),
    parseJsonRecordValue(update?.input ?? update?.arguments ?? update?.args ?? update?.params),
    parseJsonRecordValue(update?.rawOutput ?? update?.raw_output),
    parseJsonRecordValue(update?.output ?? update?.result ?? update?.content ?? update?.text),
    parseJsonRecordValue(update?.toolCall?.rawInput ?? update?.toolCall?.raw_input),
    parseJsonRecordValue(update?.toolCall?.input ?? update?.toolCall?.arguments ?? update?.toolCall?.args ?? update?.toolCall?.params),
    parseJsonRecordValue(update?.toolCall?.rawOutput ?? update?.toolCall?.raw_output),
    parseJsonRecordValue(update?.toolCall?.output ?? update?.toolCall?.result ?? update?.toolCall?.content ?? update?.toolCall?.text),
    parseJsonRecordValue(update?.tool_call?.rawInput ?? update?.tool_call?.raw_input),
    parseJsonRecordValue(update?.tool_call?.input ?? update?.tool_call?.arguments ?? update?.tool_call?.args ?? update?.tool_call?.params),
    parseJsonRecordValue(update?.tool_call?.rawOutput ?? update?.tool_call?.raw_output),
    parseJsonRecordValue(update?.tool_call?.output ?? update?.tool_call?.result ?? update?.tool_call?.content ?? update?.tool_call?.text),
  ]);
}

function resolveCodexMcp(
  toolCall: AgentToolCall,
  input: Record<string, unknown> | null,
  descriptor: CodexToolDescriptor | null,
) {
  if (descriptor?.namespace?.startsWith("mcp__") && descriptor.name) {
    const serverName = descriptor.namespace.slice("mcp__".length);
    return resolveAgentToolCallMcp({
      input: descriptor.arguments,
      toolName: `${serverName}/${descriptor.name}`,
      rawTitle: descriptor.qualifiedName ?? toolCall.title,
    });
  }
  return resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input,
    rawTitle: toolCall.title,
    toolName: descriptor?.qualifiedName,
  });
}

function mergeCodexInputSources(
  sources: Array<Record<string, unknown> | null>,
) {
  const normalizedSources = sources
    .map((source) => mergeCodexToolArguments(source))
    .filter((source): source is Record<string, unknown> => Boolean(source));
  if (!normalizedSources.length) {
    return null;
  }
  return Object.assign({}, ...normalizedSources);
}

function mergeCodexToolArguments(input: Record<string, unknown> | null) {
  if (!input) {
    return null;
  }
  const nested = parseJsonRecordValue(input.arguments ?? input.args ?? input.params ?? input.input);
  return nested ? { ...input, ...nested } : input;
}

function extractCodexMultiAgentToolName(input: Record<string, unknown> | null) {
  if (!input) {
    return undefined;
  }
  const candidate = input.name ?? input.toolName ?? input.tool_name ?? input.tool ?? input.action;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function isCodexMultiAgentNamespace(input: Record<string, unknown> | null) {
  return input?.namespace === CODEX_MULTI_AGENT_NAMESPACE || input?.tool_namespace === CODEX_MULTI_AGENT_NAMESPACE;
}

function isCodexMultiAgentToolName(value: string) {
  return CODEX_MULTI_AGENT_TOOL_TITLE.test(value) || CODEX_SUBAGENT_TOOL_TITLE.test(value);
}

function resolveCodexMultiAgentToolName(
  title: string,
  input: Record<string, unknown> | null,
  descriptor?: CodexToolDescriptor | null,
) {
  const candidate = descriptor?.name ?? extractCodexMultiAgentToolName(input) ?? title;
  const normalized = candidate.trim().replace(/^tool:\s*/iu, "");
  const appServerName = CODEX_APP_SERVER_TOOL_NAMES[normalized];
  if (appServerName) {
    return appServerName;
  }
  if (normalized === "wait" && looksLikeCodexAppServerSubagentPayload(input)) {
    return "wait_agent";
  }
  return resolveSparseCodexLifecycleToolName(normalized) ??
    (isCodexMultiAgentToolName(normalized) ? normalized : undefined);
}

function resolveSparseCodexLifecycleToolName(title: string) {
  const normalized = title.trim().replace(/^tool:\s*/iu, "");
  return CODEX_SPARSE_LIFECYCLE_TOOL_TITLE.test(normalized) ? normalized : undefined;
}

function isCodexSubagentLifecycleTool(toolName: string | undefined) {
  return toolName === "spawn_agent" ||
    toolName === "wait_agent" ||
    toolName === "close_agent" ||
    toolName === "interrupt_agent";
}

function resolveCodexSubagentActivityCommandId(
  activity: CodexSubagentActivity,
  toolCallId: string,
) {
  return activity.threadId
    ? `subagent:${activity.threadId}`
    : activity.path
      ? `subagent:${activity.path}`
      : toolCallId;
}

function resolveCodexSubagentCommandId(
  _toolName: string | undefined,
  _input: Record<string, unknown> | null,
  toolCallId: string,
) {
  // Operation rows (spawn/wait/close/interrupt) are independent timeline
  // records. Their target thread IDs belong to subagentOperation.targets and
  // must not become a shared commandId that the Deck groups into one row.
  return toolCallId;
}

function resolveCodexSubagentActivityOperation(
  activity: CodexSubagentActivity,
  toolCallId: string,
): AgentToolCall["subagentOperation"] | undefined {
  if (activity.kind === "interacted") {
    return undefined;
  }
  const id = activity.threadId ?? activity.path ?? toolCallId;
  const label = lastCodexSubagentPathSegment(activity.path);
  return {
    action: activity.kind === "started" ? "spawn" : "close",
    targets: [{ id, ...(label ? { label } : {}) }],
  };
}

function resolveCodexSubagentOperation(
  toolName: string | undefined,
  input: Record<string, unknown> | null,
  toolCallId: string,
): AgentToolCall["subagentOperation"] | undefined {
  if (
    toolName !== "spawn_agent" &&
    toolName !== "wait_agent" &&
    toolName !== "close_agent" &&
    toolName !== "interrupt_agent"
  ) {
    return undefined;
  }
  const normalized = mergeCodexToolArguments(input);
  const action = toolName === "spawn_agent"
    ? "spawn"
    : toolName === "wait_agent"
      ? "wait"
      : "close";
  if (action === "spawn") {
    const targets = resolveCodexSubagentTargets(normalized, toolCallId, true);
    return { action, targets };
  }
  return {
    action,
    targets: resolveCodexSubagentTargets(normalized, toolCallId, false),
  };
}

function resolveCodexSubagentTargets(
  input: Record<string, unknown> | null,
  toolCallId: string,
  fallbackToToolCallId: boolean,
) {
  const normalized = mergeCodexToolArguments(input);
  if (!normalized) {
    return fallbackToToolCallId ? [{ id: toolCallId }] : [];
  }
  const labelsById = new Map<string, string>();
  const ids: string[] = [];
  const add = (value: unknown, label?: unknown) => {
    const id = firstString(
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).id ??
          (value as Record<string, unknown>).agent_id ??
          (value as Record<string, unknown>).agentId ??
          (value as Record<string, unknown>).thread_id ??
          (value as Record<string, unknown>).threadId
        : value,
    );
    if (!id || ids.includes(id)) {
      return;
    }
    ids.push(id);
    const resolvedLabel = firstString(
      label,
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).label ??
          (value as Record<string, unknown>).name ??
          (value as Record<string, unknown>).nickname
        : undefined,
    );
    if (resolvedLabel) {
      labelsById.set(id, resolvedLabel);
    }
  };

  for (const id of extractCodexReceiverThreadIds(normalized)) {
    add(id);
  }
  add(normalized.target);
  for (const target of arrayValue(normalized.targets)) {
    add(target);
  }
  for (const id of arrayValue(normalized.agent_ids ?? normalized.agentIds)) {
    add(id);
  }
  add(normalized.agent_id ?? normalized.agentId);
  const states = recordValue(normalized.agentsStates ?? normalized.agents_states);
  if (states) {
    for (const [id, state] of Object.entries(states)) {
      add(id, recordValue(state)?.name ?? recordValue(state)?.nickname);
    }
  }

  if (!ids.length && fallbackToToolCallId) {
    add(toolCallId, firstString(
      normalized.task_name,
      normalized.taskName,
      normalized.agent_name,
      normalized.agentName,
      normalized.nickname,
    ));
  }
  const spawnLabel = firstString(
    normalized.task_name,
    normalized.taskName,
    normalized.agent_name,
    normalized.agentName,
    normalized.nickname,
  );
  return ids.map((id) => ({
    id,
    ...(labelsById.get(id) ?? (ids.length === 1 && spawnLabel ? spawnLabel : undefined)
      ? { label: labelsById.get(id) ?? spawnLabel }
      : {}),
  }));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function lastCodexSubagentPathSegment(path: string | undefined) {
  const segments = path?.split(/[\\/]/u).filter(Boolean);
  return segments?.at(-1);
}

export function resolveCodexSubagentActivity(
  input: unknown,
  update: unknown,
): CodexSubagentActivity | null {
  const updateRecord = recordValue(update);
  const toolCallRecord = recordValue(updateRecord?.toolCall);
  const snakeToolCallRecord = recordValue(updateRecord?.tool_call);
  // Live and replayed ACP updates can retain different halves of this metadata.
  const candidates = [
    parseJsonRecordValue(input),
    parseJsonRecordValue(updateRecord?.rawInput ?? updateRecord?.raw_input),
    parseJsonRecordValue(toolCallRecord?.rawInput ?? toolCallRecord?.raw_input),
    parseJsonRecordValue(snakeToolCallRecord?.rawInput ?? snakeToolCallRecord?.raw_input),
    resolveCodexSubagentMeta(updateRecord),
    resolveCodexSubagentMeta(toolCallRecord),
    resolveCodexSubagentMeta(snakeToolCallRecord),
  ];
  for (const candidate of candidates) {
    const activityKind = resolveCodexSubagentActivityKind(candidate);
    if (!activityKind) {
      continue;
    }
    const threadId = firstString(
      candidate?.agentThreadId,
      candidate?.agent_thread_id,
      candidate?.threadId,
    );
    const path = firstString(candidate?.agentPath, candidate?.agent_path, candidate?.path);
    if (threadId || path) {
      return {
        kind: activityKind,
        ...(threadId ? { threadId } : {}),
        ...(path ? { path } : {}),
      };
    }
  }
  return null;
}

function resolveCodexSubagentMeta(source: unknown): Record<string, unknown> | null {
  const record = recordValue(source);
  const meta = recordValue(record?._meta ?? record?.meta);
  const codex = recordValue(meta?.codex);
  return recordValue(codex?.subagent);
}

function resolveCodexSubagentActivityKind(input: unknown): CodexSubagentActivityKind | undefined {
  const record = recordValue(input);
  const value = stringValue(
    record?.activityKind ?? record?.activity_kind ?? record?.activity ?? record?.kind,
  );
  return value === "started" || value === "interacted" || value === "interrupted"
    ? value
    : undefined;
}

function extractCodexReceiverThreadIds(input: Record<string, unknown> | null) {
  // Codex App Server uses `ids` for wait/close targets while the older
  // multi-agent payload uses `receiverThreadIds`. Treat both as target
  // identities so the app-server wait operation stays in the subagent path.
  const candidates = [input?.receiverThreadIds, input?.receiver_thread_ids, input?.ids];
  const value = candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) ??
    candidates.find((candidate) => Array.isArray(candidate));
  return Array.isArray(value)
    ? value.map((item) => firstString(
        item,
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).id ??
            (item as Record<string, unknown>).threadId ??
            (item as Record<string, unknown>).thread_id
          : undefined,
      )).filter((id): id is string => Boolean(id))
    : [];
}

function looksLikeCodexAppServerSubagentPayload(input: Record<string, unknown> | null) {
  const normalized = mergeCodexToolArguments(input);
  if (!normalized) {
    return false;
  }
  return extractCodexReceiverThreadIds(normalized).length > 0;
}

function isOpaqueCodexToolTitle(title: string) {
  const normalized = title.trim();
  return !normalized || /^call_[A-Za-z0-9]+$/u.test(normalized) || /^Tool call\b/u.test(normalized);
}

function isGenericCodexWebTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return isOpaqueCodexToolTitle(title) || normalized === "run" || normalized === "web.run";
}

function parseJsonRecordValue(input: unknown): Record<string, unknown> | null {
  if (typeof input === "string") {
    return parseJsonRecord(input);
  }
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function recordValue(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function looksLikeCodexWebFetchToolCall(
  toolCall: AgentToolCall,
  input: Record<string, unknown> | null,
) {
  if (toolCall.kind !== "search") {
    return false;
  }
  if (/^web_search_/u.test(toolCall.id.trim())) {
    return true;
  }
  const title = toolCall.title.trim();
  if (!/^Searching(?:\s+the\s+Web|\s+for:)/iu.test(title)) {
    return false;
  }
  if (!input) {
    return title === "Searching the Web";
  }
  const action = input.action;
  if (action && typeof action === "object" && !Array.isArray(action)) {
    const actionType = (action as { type?: unknown }).type;
    if (typeof actionType === "string" && actionType.trim().toLowerCase() === "search") {
      return true;
    }
  }
  return typeof input.query === "string" && input.query.trim().length > 0;
}

function looksLikeCodexShellPayload(input: Record<string, unknown> | null) {
  if (!input) {
    return false;
  }
  if (typeof input.command === "string" || Array.isArray(input.command)) {
    return true;
  }
  if (Array.isArray(input.parsed_cmd)) {
    return input.parsed_cmd.some((item) =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { cmd?: unknown }).cmd === "string" &&
      (item as { cmd: string }).cmd.trim().length > 0
    );
  }
  return false;
}

function extractCodexSkillNameFromToolCall(
  toolCall: AgentToolCall,
  input: Record<string, unknown> | null,
) {
  const candidates = [
    commandValueToString(input?.command),
    commandValueToString(input?.cmd),
    commandValueToString(input?.script),
    commandValueToString(input?.shell),
    parsedCommandValueToString(input?.parsed_cmd),
    toolCall.title,
  ];
  for (const candidate of candidates) {
    const skillName = extractCodexSkillNameFromText(candidate);
    if (skillName) {
      return skillName;
    }
  }
  return undefined;
}

function parsedCommandValueToString(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { cmd?: unknown }).cmd === "string"
    ) {
      const command = (item as { cmd: string }).cmd.trim();
      if (command) {
        return command;
      }
    }
  }
  return undefined;
}

function commandValueToString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => typeof item === "string" ? item.trim() : String(item))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(" ");
    }
  }
  return undefined;
}
