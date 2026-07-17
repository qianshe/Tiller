import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";
import {
  inferClaudeTranscriptToolKind,
  readClaudeTranscriptToolUseFromDisk,
  type ClaudeTranscriptToolCallOptions,
  type ClaudeTranscriptToolUse,
} from "./transcript/tool-calls";

const CLAUDE_SUBAGENT_TOOL_NAME = /^agent$/iu;
const CLAUDE_TASK_SUBAGENT_TOOL_NAME = /^task$/iu;
const CLAUDE_SUBAGENT_MESSAGE_TOOL_NAME = /^sendmessage$/iu;
const CLAUDE_SUBAGENT_OUTPUT_TOOL_NAME = /^taskoutput$/iu;
const MAX_CLAUDE_TOOL_PROJECTIONS_PER_SESSION = 256;
const CLAUDE_SHELL_COMMAND_PREFIX = /^(?:cd|pwd|ls|cat|grep|rg|find|git|head|tail|sed|awk|xargs|pnpm|npm|node|bash|sh|for|if|echo)\b/iu;
const CLAUDE_SHELL_COMMAND_SYNTAX = /&&|\|\||\$\(|;\s|\|\s*(?:head|tail|grep|rg|sed|awk|cat)\b|(?:^|\s)\d?>\S/iu;

type ClaudeToolCallNormalizationContext = {
  toolCall: AgentToolCall;
  update: any;
  source: any;
};

type ClaudeToolCallRule = (
  context: ClaudeToolCallNormalizationContext,
) => AgentToolCall | null;

const CLAUDE_TOOL_CALL_RULES: ClaudeToolCallRule[] = [
  normalizeClaudeCompletedSubagentToolCall,
  normalizeClaudeTaskOutputToolCall,
  normalizeClaudeTitleSubagentToolCall,
  normalizeClaudePayloadSubagentToolCall,
  normalizeClaudeSubagentMessageToolCall,
  normalizeClaudeSkillToolCall,
  normalizeClaudeMcpToolCall,
  normalizeClaudeShellSearchToolCall,
];

type ClaudeToolCallProjection = {
  id: string;
  commandId?: string;
  kind: AgentToolCall["kind"];
  title: string;
  input?: string;
  background: boolean;
};

type ClaudeSessionToolCallProjections = {
  byToolCallId: Map<string, ClaudeToolCallProjection>;
  primaryByCommandId: Map<string, ClaudeToolCallProjection>;
};

export function createClaudeToolCallNormalizer(
  readTranscriptToolUse: (
    options: ClaudeTranscriptToolCallOptions & { toolCallId: string },
  ) => ClaudeTranscriptToolUse | null = readClaudeTranscriptToolUseFromDisk,
) {
  const projectionsBySession = new Map<string, ClaudeSessionToolCallProjections>();
  return {
    normalize(
      toolCall: AgentToolCall,
      update: unknown,
      sessionId?: string,
      cwd?: string,
    ) {
      const weakPlaceholder = isWeakClaudeToolCallPlaceholder(toolCall, update);
      let normalized = normalizeClaudeToolCall(toolCall, update);
      if (!sessionId) {
        return weakPlaceholder ? null : normalized;
      }
      const sessionProjections = projectionsBySession.get(sessionId) ?? {
        byToolCallId: new Map<string, ClaudeToolCallProjection>(),
        primaryByCommandId: new Map<string, ClaudeToolCallProjection>(),
      };
      projectionsBySession.set(sessionId, sessionProjections);
      const projections = sessionProjections.byToolCallId;
      let recoveredTranscriptDetails = false;
      if (cwd && shouldRecoverClaudeTranscriptDetails(normalized)) {
        const transcriptToolUse = readTranscriptToolUse({
          runtimeSessionId: sessionId,
          cwd,
          toolCallId: toolCall.id,
        });
        const transcriptInput = objectFromUnknown(transcriptToolUse?.input);
        const transcriptKind = transcriptToolUse
          ? inferClaudeTranscriptToolKind(transcriptToolUse.name)
          : undefined;
        if (transcriptToolUse && transcriptKind === "search") {
          recoveredTranscriptDetails = true;
          normalized = {
            ...normalized,
            kind: "search",
            title: isClaudeInputStreaming(normalized.status)
              ? "Search"
              : transcriptToolUse.name,
            ...(transcriptInput
              ? { input: JSON.stringify(transcriptInput) }
              : {}),
          };
        } else {
          const command = commandValueToString(
            transcriptInput?.command ??
              transcriptInput?.cmd ??
              transcriptInput?.script ??
              transcriptInput?.shell ??
              transcriptInput?.args,
          )?.trim();
          if (command) {
            recoveredTranscriptDetails = true;
            normalized = {
              ...normalized,
              title: isClaudeInputStreaming(normalized.status) ? "Shell" : command,
              input: JSON.stringify(transcriptInput),
            };
          }
        }
      }
      if (weakPlaceholder && !recoveredTranscriptDetails) {
        return null;
      }
      const previous = projections.get(toolCall.id);
      const background = previous?.background ||
        isBackgroundSubagentPayload(toolCall, update);
      if (
        previous &&
        previous.kind !== "subagent" &&
        previous.kind === normalized.kind
      ) {
        normalized = {
          ...normalized,
          id: previous.id,
          kind: previous.kind,
          title: normalized.kind === "shell"
            ? resolveClaudeShellProjectionTitle(previous.title, normalized)
            : normalized.kind === "search"
              ? resolveClaudeSearchProjectionTitle(previous.title, normalized)
              : previous.title,
          input: normalized.input ?? previous.input,
        };
      }
      if (previous?.kind === "subagent") {
        const source = (update as any)?.toolCall ??
          (update as any)?.tool_call ??
          update;
        const outputAgentId = extractClaudeBackgroundAgentId(
          extractClaudeToolOutputText(toolCall, source),
        );
        const commandId = normalized.commandId ??
          previous.commandId ??
          (outputAgentId ? `subagent:${outputAgentId}` : undefined);
        normalized = {
          ...normalized,
          id: previous.id,
          kind: "subagent",
          title: previous.title,
          ...(commandId
            ? { commandId }
            : {}),
          ...(background ? { status: "running" as const } : {}),
        };
      }
      const lifecycleUpdate = normalized.kind === "subagent" &&
        isClaudeSubagentLifecycleUpdate(toolCall);
      if (normalized.kind === "subagent") {
        const primary = normalized.commandId
          ? sessionProjections.primaryByCommandId.get(normalized.commandId)
          : undefined;
        if (lifecycleUpdate && primary) {
          normalized = {
            ...normalized,
            id: primary.id,
            title: primary.title,
          };
        }
      }
      projections.delete(toolCall.id);
      const projection = {
        id: normalized.id,
        kind: normalized.kind,
        title: normalized.title,
        input: normalized.input,
        commandId: normalized.commandId,
        background,
      } satisfies ClaudeToolCallProjection;
      projections.set(toolCall.id, projection);
      if (
        normalized.kind === "subagent" &&
        normalized.commandId &&
        !lifecycleUpdate
      ) {
        sessionProjections.primaryByCommandId.set(
          normalized.commandId,
          projection,
        );
      }
      trimClaudeToolCallProjections(sessionProjections);
      return normalized;
    },
    disposeSession(sessionId: string) {
      projectionsBySession.delete(sessionId);
    },
  };
}

export function normalizeClaudeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const context: ClaudeToolCallNormalizationContext = {
    toolCall,
    update,
    source,
  };
  for (const rule of CLAUDE_TOOL_CALL_RULES) {
    const normalized = rule(context);
    if (normalized) {
      return normalized;
    }
  }
  return toolCall;
}

function normalizeClaudeCompletedSubagentToolCall({
  toolCall,
  update,
  source,
}: ClaudeToolCallNormalizationContext) {
  const output = extractClaudeToolOutputText(toolCall, source);
  if (looksLikeClaudeBackgroundAgentLaunch(output)) {
    const taskId = extractClaudeBackgroundAgentId(output);
    const { output: _output, ...summary } = toolCall;
    return {
      ...summary,
      kind: "subagent" as const,
      title: isSubagentPayload(toolCall, update)
        ? toolCall.title
        : "Subagent",
      status: "running" as const,
      ...(taskId ? { commandId: `subagent:${taskId}` } : {}),
    };
  }
  const taskId = extractClaudeTaskLifecycleId(toolCall, output);
  if (!taskId) {
    return null;
  }
  const taskOutput = extractClaudeTaskOutput(output);
  const { input: _input, output: _output, ...summary } = toolCall;
  return {
    ...summary,
    kind: "subagent" as const,
    title: "Subagent",
    commandId: `subagent:${taskId}`,
    ...(taskOutput ? { output: taskOutput } : {}),
  };
}

function normalizeClaudeTitleSubagentToolCall({
  toolCall,
}: ClaudeToolCallNormalizationContext) {
  if (!CLAUDE_SUBAGENT_TOOL_NAME.test(toolCall.title ?? "")) {
    return null;
  }
  return { ...toolCall, kind: "subagent" as const };
}

function normalizeClaudeTaskOutputToolCall({
  toolCall,
}: ClaudeToolCallNormalizationContext) {
  if (!CLAUDE_SUBAGENT_OUTPUT_TOOL_NAME.test(toolCall.title ?? "")) {
    return null;
  }
  const { input: _input, output: _output, ...summary } = toolCall;
  return {
    ...summary,
    kind: "subagent" as const,
    title: "Subagent",
    status: "running" as const,
  };
}

function normalizeClaudePayloadSubagentToolCall(
  context: ClaudeToolCallNormalizationContext,
) {
  if (!isSubagentPayload(context.toolCall, context.update)) {
    return null;
  }
  const output = extractClaudeToolOutputText(context.toolCall, context.source);
  const agentId = extractClaudeBackgroundAgentId(output);
  const background = isBackgroundSubagentPayload(
    context.toolCall,
    context.update,
  );
  const source = context.update?.toolCall ??
    context.update?.tool_call ??
    context.update;
  const input = objectFromUnknown(
    source?.rawInput ??
      source?.raw_input ??
      source?.input ??
      context.toolCall.input,
  );
  const description = stringFrom(input?.description)?.trim();
  const normalizedInput = input &&
      (!context.toolCall.input || context.toolCall.input === "{}")
    ? JSON.stringify(input)
    : context.toolCall.input;
  return {
    ...context.toolCall,
    kind: "subagent" as const,
    title: description && isGenericSubagentTitle(context.toolCall.title)
      ? description
      : context.toolCall.title,
    ...(normalizedInput ? { input: normalizedInput } : {}),
    ...(background ? { status: "running" as const } : {}),
    ...(agentId ? { commandId: `subagent:${agentId}` } : {}),
  };
}

function normalizeClaudeSubagentMessageToolCall({
  toolCall,
  source,
}: ClaudeToolCallNormalizationContext) {
  if (!CLAUDE_SUBAGENT_MESSAGE_TOOL_NAME.test(toolCall.title ?? "")) {
    return null;
  }
  const input = objectFromUnknown(
    source?.rawInput ?? source?.raw_input ?? source?.input ?? toolCall.input,
  );
  const agentId = stringFrom(
    input?.to ?? input?.recipient ?? input?.agentId ?? input?.agent_id,
  )?.trim();
  const { input: _input, output: _output, ...summary } = toolCall;
  return {
    ...summary,
    kind: "subagent" as const,
    title: "Subagent",
    status: "running" as const,
    ...(agentId ? { commandId: `subagent:${agentId}` } : {}),
  };
}

function normalizeClaudeSkillToolCall({
  toolCall,
  source,
}: ClaudeToolCallNormalizationContext) {
  const input = objectFromUnknown(
    source?.rawInput ?? source?.raw_input ?? source?.input ?? toolCall.input,
  );
  const skillName = stringFrom(input?.skill ?? input?.skillName)?.trim();
  if (!skillName) {
    return null;
  }
  return {
    ...toolCall,
    kind: "skill" as const,
    title: `Skill: ${skillName}`,
  };
}

function normalizeClaudeMcpToolCall({
  toolCall,
  source,
}: ClaudeToolCallNormalizationContext) {
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: source?.rawInput ?? source?.raw_input ?? source?.input ?? toolCall.input,
    title: toolCall.title,
    rawTitle: stringFrom(
      source?.title ??
        source?.label ??
        source?.displayName ??
        source?.display_name ??
        source?.name ??
        source?.toolName ??
        source?.tool_name ??
        source?.tool,
    ),
  });
  if (!mcp) {
    return null;
  }
  return { ...toolCall, kind: "mcp" as const, title: formatAgentToolCallMcpTitle(mcp), mcp };
}

function normalizeClaudeShellSearchToolCall({
  toolCall,
  update,
}: ClaudeToolCallNormalizationContext) {
  const structuredSearchPayload = looksLikeStructuredSearchPayload(toolCall, update);
  const shellCommand = extractClaudeShellCommand(toolCall, update);
  if (
    toolCall.kind === "search" &&
    shellCommand &&
    !structuredSearchPayload
  ) {
    return {
      ...toolCall,
      kind: "shell" as const,
      title: isClaudeInputStreaming(toolCall.status) ? "Shell" : shellCommand,
    };
  }
  if (toolCall.kind === "shell" && structuredSearchPayload) {
    return {
      ...toolCall,
      kind: "search" as const,
      ...(isClaudeInputStreaming(toolCall.status) ? { title: "Search" } : {}),
    };
  }
  if (
    toolCall.kind === "search" &&
    structuredSearchPayload &&
    isClaudeInputStreaming(toolCall.status)
  ) {
    return { ...toolCall, title: "Search" };
  }
  if (toolCall.kind === "shell" && shellCommand) {
    return {
      ...toolCall,
      title: isClaudeInputStreaming(toolCall.status) ? "Shell" : shellCommand,
    };
  }
  return null;
}

function resolveClaudeShellProjectionTitle(
  previousTitle: string,
  normalized: AgentToolCall,
) {
  if (
    isClaudeInputStreaming(normalized.status) ||
    isGenericClaudeShellTitle(normalized.title)
  ) {
    return previousTitle;
  }
  return normalized.title;
}

function resolveClaudeSearchProjectionTitle(
  previousTitle: string,
  normalized: AgentToolCall,
) {
  if (
    isClaudeInputStreaming(normalized.status) ||
    isGenericClaudeSearchTitle(normalized.title)
  ) {
    return previousTitle;
  }
  return normalized.title;
}

function isClaudeInputStreaming(status: AgentToolCall["status"]) {
  return status === "pending" || status === "running";
}

function isGenericClaudeShellTitle(title: string) {
  return /^(?:Bash|Shell|Tool call\b)/iu.test(title.trim());
}

function isGenericClaudeSearchTitle(title: string) {
  return /^(?:Search|Tool call\b)/iu.test(title.trim());
}

function shouldRecoverClaudeTranscriptDetails(toolCall: AgentToolCall) {
  return (
    toolCall.kind === "shell" && isGenericClaudeShellTitle(toolCall.title)
  ) || (
    (toolCall.kind === "search" || toolCall.kind === "shell") &&
    isGenericClaudeSearchTitle(toolCall.title)
  );
}

function isSubagentPayload(toolCall: AgentToolCall, update: any): boolean {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const rawInput = source?.rawInput ?? source?.raw_input;
  if (rawInput && typeof rawInput === "object" && typeof rawInput.subagent_type === "string") {
    return true;
  }
  const input = parseInput(toolCall.input);
  if (input && typeof input.subagent_type === "string") {
    return true;
  }
  if (CLAUDE_TASK_SUBAGENT_TOOL_NAME.test(toolCall.title ?? "")) {
    if (input && typeof input.prompt === "string") {
      return true;
    }
  }
  return false;
}

function isBackgroundSubagentPayload(
  toolCall: AgentToolCall,
  update: unknown,
) {
  const source = (update as any)?.toolCall ?? (update as any)?.tool_call ?? update;
  const input = objectFromUnknown(
    (source as any)?.rawInput ??
      (source as any)?.raw_input ??
      (source as any)?.input ??
      toolCall.input,
  );
  return input?.run_in_background === true ||
    input?.runInBackground === true;
}

function isGenericSubagentTitle(title: string) {
  return /^(?:Subagent|Tool call\b)/iu.test(title.trim());
}

function trimClaudeToolCallProjections(
  sessionProjections: ClaudeSessionToolCallProjections,
) {
  while (
    sessionProjections.byToolCallId.size >
      MAX_CLAUDE_TOOL_PROJECTIONS_PER_SESSION
  ) {
    const oldestId = sessionProjections.byToolCallId.keys().next().value;
    if (typeof oldestId !== "string") {
      break;
    }
    sessionProjections.byToolCallId.delete(oldestId);
  }
  while (
    sessionProjections.primaryByCommandId.size >
      MAX_CLAUDE_TOOL_PROJECTIONS_PER_SESSION
  ) {
    const oldestCommandId = sessionProjections.primaryByCommandId
      .keys()
      .next()
      .value;
    if (typeof oldestCommandId !== "string") {
      break;
    }
    sessionProjections.primaryByCommandId.delete(oldestCommandId);
  }
}

function isClaudeSubagentLifecycleUpdate(toolCall: AgentToolCall) {
  const title = toolCall.title?.trim() ?? "";
  return CLAUDE_SUBAGENT_MESSAGE_TOOL_NAME.test(title) ||
    CLAUDE_SUBAGENT_OUTPUT_TOOL_NAME.test(title);
}

function isWeakClaudeToolCallPlaceholder(
  toolCall: AgentToolCall,
  update: unknown,
) {
  if (toolCall.commandId) {
    return false;
  }
  const title = toolCall.title?.trim() ?? "";
  const isDeferredTitle = /^(?:Task|SendMessage|TaskOutput|Tool call\b)/iu.test(title);
  if (!isDeferredTitle) {
    return false;
  }
  const source = (update as any)?.toolCall ?? (update as any)?.tool_call ?? update;
  const input = objectFromUnknown(
    (source as any)?.rawInput ??
      (source as any)?.raw_input ??
      (source as any)?.input ??
      toolCall.input,
  );
  const hasInput = Boolean(input && Object.keys(input).length > 0);
  const output = (extractClaudeToolOutputText(toolCall, source) ?? "").trim();
  const hasOutput = output !== "" && output !== "[]" && output !== "{}";
  return !hasInput && !hasOutput;
}

function extractClaudeShellCommand(
  toolCall: AgentToolCall,
  update: unknown,
) {
  const source = (update as any)?.toolCall ?? (update as any)?.tool_call ?? update;
  const inputs = [
    objectFromUnknown((source as any)?.rawInput),
    objectFromUnknown((source as any)?.raw_input),
    objectFromUnknown((source as any)?.input),
    objectFromUnknown(toolCall.input),
  ].filter((input): input is Record<string, unknown> => Boolean(input));
  for (const input of inputs) {
    const command = commandValueToString(
      input.command ?? input.cmd ?? input.script ?? input.shell ?? input.args,
    )?.trim();
    if (command) {
      return command;
    }
  }
  return extractCommandTextCandidates(toolCall, update)
    .find(looksLikeShellCommandText)
    ?.trim();
}

function looksLikeStructuredSearchPayload(toolCall: AgentToolCall, update: any): boolean {
  const candidates = extractStructuredInputCandidates(toolCall, update);
  return candidates.some(isStructuredSearchPayload);
}

function looksLikeShellCommandText(value: string): boolean {
  const trimmed = value.trim();
  return CLAUDE_SHELL_COMMAND_PREFIX.test(trimmed) || CLAUDE_SHELL_COMMAND_SYNTAX.test(trimmed);
}

function extractCommandTextCandidates(toolCall: AgentToolCall, update: any): string[] {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const rawCandidates = [
    toolCall.title,
    stringFrom(source?.title),
    stringFrom(source?.input),
    stringFrom(source?.rawInput),
    stringFrom(source?.raw_input),
  ].filter((value): value is string => Boolean(value?.trim()));
  const parsedCandidates = rawCandidates.flatMap(extractParsedCommandCandidates);
  return [...rawCandidates, ...parsedCandidates];
}

function extractParsedCommandCandidates(value: string): string[] {
  const parsed = parseInput(value);
  if (!parsed) {
    return [];
  }
  return [
    commandValueToString(parsed.command),
    commandValueToString(parsed.cmd),
    commandValueToString(parsed.script),
    commandValueToString(parsed.shell),
    commandValueToString(parsed.args),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

function extractStructuredInputCandidates(
  toolCall: AgentToolCall,
  update: any,
): Array<Record<string, unknown>> {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  return [
    objectFromUnknown(toolCall.input),
    objectFromUnknown(source?.input),
    objectFromUnknown(source?.rawInput),
    objectFromUnknown(source?.raw_input),
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
}

function isStructuredSearchPayload(input: Record<string, unknown>): boolean {
  const hasSearchPattern =
    typeof input.pattern === "string" ||
    typeof input.search_string === "string" ||
    typeof input.substring_pattern === "string";
  const hasShellCommand =
    input.command !== undefined ||
    input.cmd !== undefined ||
    input.script !== undefined ||
    input.shell !== undefined ||
    input.args !== undefined;
  return hasSearchPattern && !hasShellCommand;
}

function commandValueToString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" ");
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return undefined;
}

function parseInput(input: string | undefined): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function objectFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return parseInput(value);
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function extractClaudeToolOutputText(toolCall: AgentToolCall, source: any) {
  const candidates = [
    toolCall.output,
    source?.rawOutput,
    source?.raw_output,
    source?.output,
    source?.result,
    source?.content,
    source?.text,
  ];
  for (const candidate of candidates) {
    const text = extractClaudeText(candidate);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function extractClaudeText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const parsedText = extractClaudeText(parsed);
      if (parsedText) {
        return parsedText;
      }
    } catch {
      // Claude ACP may send plain text output.
    }
    return value;
  }
  if (Array.isArray(value)) {
    const text = value
      .map(extractClaudeText)
      .filter((item): item is string => Boolean(item))
      .join("\n");
    return text || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return extractClaudeText(record.text) ??
    extractClaudeText(record.output) ??
    extractClaudeText(record.content);
}

function looksLikeClaudeBackgroundAgentLaunch(output: string | undefined) {
  return Boolean(
    output &&
    /\bAsync agent launched successfully\./iu.test(output) &&
    /\bagentId:\s*\S+/iu.test(output),
  );
}

function extractClaudeBackgroundAgentId(output: string | undefined) {
  return output?.match(/\bagentId:\s*([A-Za-z0-9_-]+)/iu)?.[1];
}

function extractClaudeTaskId(output: string | undefined) {
  return output?.match(/<task_id>\s*([^<\s]+)\s*<\/task_id>/iu)?.[1];
}

function extractClaudeTaskLifecycleId(
  toolCall: AgentToolCall,
  output: string | undefined,
) {
  if (!/^TaskOutput$/iu.test(toolCall.title.trim())) {
    return undefined;
  }
  return extractClaudeTaskId(output) ??
    stringFrom(parseInput(toolCall.input)?.task_id)?.trim();
}

function extractClaudeTaskOutput(output: string | undefined) {
  const match = output?.match(/<output>\s*([\s\S]*?)\s*<\/output>/iu);
  return match?.[1]?.trim() || undefined;
}
