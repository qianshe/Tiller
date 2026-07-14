import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";
import { extractCodexSkillNameFromText, formatCodexSkillTitle } from "./skill-tools";

const CODEX_SUBAGENT_TOOL_TITLE = /^spawn_agents_/u;
const CODEX_MULTI_AGENT_TOOL_TITLE = /^(?:spawn_agent|send_message|send_input|followup_task|wait_agent|interrupt_agent|list_agents|close_agent|resume_agent)$/u;
const CODEX_MULTI_AGENT_NAMESPACE = "multi_agent_v1";
const CODEX_WEB_NAMESPACE = "web";

type CodexToolCallNormalizationContext = {
  toolCall: AgentToolCall;
  input: Record<string, unknown> | null;
  descriptor: CodexToolDescriptor | null;
};

type CodexToolCallRule = {
  match(context: CodexToolCallNormalizationContext): boolean;
  normalize(context: CodexToolCallNormalizationContext): AgentToolCall;
};

const CODEX_TOOL_CALL_RULES: CodexToolCallRule[] = [
  {
    match: ({ toolCall, input, descriptor }) =>
      looksLikeCodexSubagentToolCall(toolCall, input, descriptor),
    normalize: ({ toolCall, input, descriptor }) => {
      const toolName = descriptor?.name ?? extractCodexMultiAgentToolName(input);
      const identity = resolveCodexSubagentIdentity(input);
      return {
        ...toolCall,
        kind: "subagent" as const,
        ...(identity && isCodexSubagentLifecycleTool(toolName)
          ? {
              commandId: `subagent:${identity}`,
              title: `Subagent: ${identity}`,
            }
          : isOpaqueCodexToolTitle(toolCall.title) && toolName
            ? { title: toolName }
            : {}),
        ...(toolName === "spawn_agent" && toolCall.status === "completed"
          ? { status: "running" as const }
          : {}),
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
        ? { title: resolveCodexWebToolTitle(descriptor) }
        : {}),
    }),
  },
  {
    match: ({ input }) => looksLikeCodexShellPayload(input),
    normalize: ({ toolCall }) => ({ ...toolCall, kind: "shell" as const }),
  },
];

export function normalizeCodexToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const input = resolveNormalizedCodexToolInput(toolCall, update);
  const descriptor = resolveCodexToolDescriptor(input);
  const context: CodexToolCallNormalizationContext = {
    toolCall,
    input,
    descriptor,
  };
  for (const rule of CODEX_TOOL_CALL_RULES) {
    if (rule.match(context)) {
      return rule.normalize(context);
    }
  }
  return toolCall;
}

function resolveCodexWebToolTitle(descriptor: CodexToolDescriptor) {
  const query = firstString(
    descriptor.arguments?.query,
    descriptor.arguments?.search_query,
    descriptor.arguments?.searchQuery,
  );
  return query ? `Searching for: ${query}` : "Searching the Web";
}

function looksLikeCodexSubagentToolCall(
  toolCall: AgentToolCall,
  input: Record<string, unknown> | null,
  descriptor: CodexToolDescriptor | null,
) {
  const toolName = descriptor?.name ?? extractCodexMultiAgentToolName(input);
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
    return false;
  }
  const toolName = extractCodexMultiAgentToolName(normalizedInput);
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

function isCodexSubagentLifecycleTool(toolName: string | undefined) {
  return toolName === "spawn_agent" ||
    toolName === "wait_agent" ||
    toolName === "close_agent" ||
    toolName === "interrupt_agent";
}

function resolveCodexSubagentIdentity(input: Record<string, unknown> | null) {
  const normalized = mergeCodexToolArguments(input);
  if (!normalized) {
    return undefined;
  }
  const direct = firstString(
    normalized.task_name,
    normalized.taskName,
    normalized.agent_name,
    normalized.agentName,
    normalized.target,
  );
  if (direct) {
    return direct;
  }
  return Array.isArray(normalized.targets)
    ? firstString(...normalized.targets)
    : undefined;
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
