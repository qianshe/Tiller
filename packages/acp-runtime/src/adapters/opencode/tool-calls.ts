import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";
import { classifyStructuredFileOperation } from "../../tool-recognition/file-operation";

type OpenCodeToolCallNormalizationContext = {
  toolCall: AgentToolCall;
  source: any;
};

type OpenCodeToolCallRule = (
  context: OpenCodeToolCallNormalizationContext,
) => AgentToolCall | null;

const OPENCODE_TOOL_CALL_RULES: OpenCodeToolCallRule[] = [
  normalizeOpenCodeSubagentRule,
  normalizeOpenCodeSkillRule,
  normalizeOpenCodeMcpRule,
  normalizeOpenCodeStructuredBuiltinRule,
  normalizeOpenCodeOpaqueRule,
];

export function normalizeOpenCodeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = resolveOpenCodeSource(update);
  const context: OpenCodeToolCallNormalizationContext = { toolCall, source };
  for (const rule of OPENCODE_TOOL_CALL_RULES) {
    const normalized = rule(context);
    if (normalized) {
      return normalized;
    }
  }
  return toolCall;
}

function normalizeOpenCodeMcpRule({
  toolCall,
  source,
}: OpenCodeToolCallNormalizationContext) {
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: source?.rawInput ?? source?.raw_input ?? source?.input ?? source?.state?.input ?? toolCall.input,
    title: toolCall.title,
    rawTitle: typeof toolCall.title === "string" ? toolCall.title : undefined,
  });
  if (!mcp) {
    return null;
  }
  return { ...toolCall, kind: "mcp" as const, title: formatAgentToolCallMcpTitle(mcp), mcp };
}

function normalizeOpenCodeSubagentRule({
  toolCall,
  source,
}: OpenCodeToolCallNormalizationContext) {
  return normalizeOpenCodeSubagentToolCall(toolCall, source);
}

function normalizeOpenCodeSkillRule({
  toolCall,
  source,
}: OpenCodeToolCallNormalizationContext) {
  const input = resolveOpenCodeInputRecord(toolCall, source);
  const descriptor = firstString(
    source?.name,
    source?.toolName,
    source?.tool_name,
    source?.title,
    toolCall.title,
  );
  if (toolCall.kind !== "skill" && !/^(?:Tool:\s*)?skill$/iu.test(descriptor ?? "")) {
    return null;
  }
  const name = firstString(
    input?.name,
    input?.skill,
    input?.skillName,
    input?.skill_name,
  );
  const outputText = firstString(
    source?.output,
    source?.result,
    source?.rawOutput,
    source?.raw_output,
    source?.state?.output,
    toolCall.output,
  );
  const title = name ? `Skill: ${name}` : resolveOpenCodeSkillTitle(outputText) ?? "Skill";
  const { input: _input, output: _output, ...summary } = toolCall;
  return { ...summary, kind: "skill" as const, title };
}

function normalizeOpenCodeStructuredBuiltinRule({
  toolCall,
  source,
}: OpenCodeToolCallNormalizationContext) {
  const descriptor = firstString(
    source?.name,
    source?.toolName,
    source?.tool_name,
    source?.tool,
    source?.title,
    toolCall.title,
  ) ?? "";
  const input = resolveOpenCodeInputRecord(toolCall, source);
  const todos = Array.isArray(input?.todos) ? input.todos : null;
  if (todos || /^todo[_-]?write$/iu.test(descriptor)) {
    const count = todos?.length;
    const finalTitle = typeof count === "number"
      ? `Update ${count} ${count === 1 ? "todo" : "todos"}`
      : "Update todos";
    return {
      ...toolCall,
      kind: "todo" as const,
      title: resolveOpenCodeStructuredTitle(toolCall, "Update todos", finalTitle),
    };
  }
  if (!input) {
    return null;
  }

  const fileOperation = classifyStructuredFileOperation(input);
  const path = fileOperation?.path;
  if (/diagnostic/iu.test(descriptor) && path) {
    return {
      ...toolCall,
      kind: "diagnostics" as const,
      title: resolveOpenCodeStructuredTitle(
        toolCall,
        "Diagnostics",
        `Diagnostics: ${compactOpenCodePath(path)}`,
      ),
    };
  }

  const command = firstString(input.command, input.cmd, input.script, input.shell);
  if (command) {
    return {
      ...toolCall,
      kind: "shell" as const,
      title: resolveOpenCodeStructuredTitle(
        toolCall,
        "Shell",
        compactOpenCodeTitle(command),
      ),
    };
  }

  const url = firstString(input.url);
  if (url) {
    return {
      ...toolCall,
      kind: "fetch" as const,
      title: resolveOpenCodeStructuredTitle(toolCall, "Fetch", url),
    };
  }

  const query = firstString(
    input.pattern,
    input.query,
    input.search_string,
    input.searchString,
    input.substring_pattern,
    input.substringPattern,
  );
  if (query) {
    const label = resolveOpenCodeSearchLabel(descriptor);
    return {
      ...toolCall,
      kind: "search" as const,
      title: resolveOpenCodeStructuredTitle(
        toolCall,
        "Search",
        `${label}: ${truncateOpenCodeTitle(query, 56)}`,
      ),
    };
  }

  if (fileOperation) {
    const isWrite = fileOperation.kind === "write";
    return {
      ...toolCall,
      kind: isWrite ? "write" as const : "read" as const,
      title: resolveOpenCodeStructuredTitle(
        toolCall,
        isWrite ? "Write" : "Read",
        resolveOpenCodePathTitle(toolCall.title, fileOperation.path),
      ),
    };
  }
  return null;
}

function normalizeOpenCodeOpaqueRule({
  toolCall,
  source,
}: OpenCodeToolCallNormalizationContext) {
  return normalizeOpenCodeOpaqueToolCall(toolCall, source);
}

function normalizeOpenCodeSubagentToolCall(
  toolCall: AgentToolCall,
  source: any,
): AgentToolCall | null {
  if (isOpenCodeBackgroundOutputTool(toolCall, source)) {
    // A previous generic projection can already have marked this builtin as a
    // subagent from task metadata in its output. Keep the launch acknowledgement
    // running semantics, but do not let the output text turn it into a subagent.
    const normalizedToolCall = toolCall.kind === "subagent"
      ? { ...toolCall, kind: "tool" as const }
      : toolCall;
    // OpenCode emits background_output as the parent-agent's result
    // notification. It has no useful long-lived lifecycle of its own, and
    // some versions never send a terminal update after the running frame.
    // Treat the invocation itself as complete while preserving any real
    // terminal status that was already supplied by the provider.
    return normalizedToolCall.status === "pending" || normalizedToolCall.status === "running"
      ? { ...normalizedToolCall, status: "completed" as const }
      : normalizedToolCall;
  }
  const inputRecord = parseJsonRecord(
    source?.rawInput ??
      source?.raw_input ??
      source?.input ??
      source?.state?.input ??
      toolCall.input,
  );
  const outputRecord = parseJsonRecord(
    source?.output ??
      source?.result ??
      source?.rawOutput ??
      source?.raw_output ??
      source?.content ??
      source?.text ??
      source?.state?.output ??
      toolCall.output,
  );
  const outputMetadata = resolveOpenCodeMetadata(
    outputRecord,
    source?.rawOutput,
    source?.raw_output,
    source?.output,
    source?.result,
    source?.content,
    source?.text,
    source?.metadata,
    source?.state?.metadata,
    toolCall.output,
  );
  const outputText = firstOpenCodeText(
    outputRecord?.output,
    source?.output,
    source?.result,
    source?.rawOutput,
    source?.raw_output,
    source?.content,
    source?.text,
    source?.state?.output,
    toolCall.output,
  );

  if (
    !looksLikeOpenCodeLiveSubagentInput(toolCall.title, inputRecord) &&
    !looksLikeOpenCodeCompletedSubagent(outputMetadata, outputText)
  ) {
    return null;
  }

  const normalizedInput =
    toolCall.input ??
    stringifyRecord(outputMetadata) ??
    stringifyRecord(inputRecord);
  const title = resolveOpenCodeSubagentTitle(toolCall.title, inputRecord, outputMetadata);
  const taskId = firstString(
    outputMetadata?.taskId,
    outputMetadata?.task_id,
    outputMetadata?.sessionId,
    outputMetadata?.session_id,
    inputRecord?.taskId,
    inputRecord?.task_id,
    inputRecord?.sessionId,
    inputRecord?.session_id,
    outputMetadata?.backgroundTaskId,
    outputMetadata?.background_task_id,
    inputRecord?.backgroundTaskId,
    inputRecord?.background_task_id,
    extractOpenCodeId(outputText, "background[_ -]?task[_ -]?id"),
    extractOpenCodeId(outputText, "task[_ -]?id"),
    extractOpenCodeId(outputText, "session[_ -]?id"),
  );

  return {
    ...toolCall,
    kind: "subagent" as const,
    title,
    ...(taskId ? { commandId: `subagent:${taskId}` } : {}),
    ...(normalizedInput ? { input: normalizedInput } : {}),
  };
}

function isOpenCodeBackgroundOutputTool(toolCall: AgentToolCall, source: any) {
  const descriptor = firstString(
    source?.name,
    source?.toolName,
    source?.tool_name,
    source?.tool,
    source?.title,
    toolCall.title,
  );
  return /^(?:tool:\s*)?background[_ -]?output$/iu.test(descriptor ?? "");
}

function normalizeOpenCodeOpaqueToolCall(
  toolCall: AgentToolCall,
  source: any,
): AgentToolCall | null {
  if (toolCall.kind !== "tool" && toolCall.kind !== "unknown") {
    return null;
  }

  const outputRecord = parseJsonRecord(
    source?.output ??
      source?.result ??
      source?.rawOutput ??
      source?.raw_output ??
      source?.content ??
      source?.text ??
      source?.state?.output ??
      toolCall.output,
  );
  const outputMetadata = resolveOpenCodeMetadata(
    outputRecord,
    source?.rawOutput,
    source?.raw_output,
    source?.output,
    source?.result,
    source?.content,
    source?.text,
    source?.metadata,
    source?.state?.metadata,
    toolCall.output,
  );
  const displayMetadata = recordFrom(outputMetadata?.display);
  const outputText = firstOpenCodeText(
    outputRecord?.output,
    source?.output,
    source?.result,
    source?.rawOutput,
    source?.raw_output,
    source?.content,
    source?.text,
    source?.state?.output,
    toolCall.output,
  );
  const nestedOutputRecord = parseJsonRecord(outputText);
  const path = firstString(
    displayMetadata?.path,
    outputMetadata?.filepath,
    extractTaggedOutputValue(outputText, "path"),
  );
  const outputType = firstString(
    displayMetadata?.type,
    extractTaggedOutputValue(outputText, "type"),
  );

  const skillTitle = resolveOpenCodeSkillTitle(outputText);
  if (skillTitle) {
    const { input: _input, output: _output, ...summary } = toolCall;
    return { ...summary, kind: "skill", title: skillTitle };
  }

  if ((outputType === "file" || outputType === "directory") && path) {
    return { ...toolCall, kind: "read", title: path };
  }

  if (Array.isArray(nestedOutputRecord?.resources) && nestedOutputRecord.resources.length > 0) {
    return {
      ...toolCall,
      kind: "read",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "MCP resources"),
    };
  }

  if (looksLikeOpenCodeSessionInfoOutput(outputText)) {
    return {
      ...toolCall,
      kind: "read",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "Session info"),
    };
  }

  if (looksLikeOpenCodeSessionListOutput(outputText)) {
    return {
      ...toolCall,
      kind: "read",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "Session list"),
    };
  }

  if (looksLikeOpenCodeDiagnosticsOutput(outputText)) {
    return {
      ...toolCall,
      kind: "diagnostics",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "Diagnostics"),
    };
  }

  if (looksLikeOpenCodeSymbolListOutput(outputText)) {
    return {
      ...toolCall,
      kind: "search",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "Symbols"),
    };
  }

  if (looksLikeOpenCodeWriteOutput(outputText)) {
    return {
      ...toolCall,
      kind: "write",
      title: preferOpenCodeRecoveredTitle(toolCall.title, path ?? "Write"),
    };
  }

  if (looksLikeOpenCodeSearchOutput(outputText, outputRecord, nestedOutputRecord)) {
    return {
      ...toolCall,
      kind: "search",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "Search"),
    };
  }

  if (looksLikeOpenCodeFetchOutput(toolCall.title, outputText, nestedOutputRecord)) {
    return {
      ...toolCall,
      kind: "fetch",
      title: preferOpenCodeRecoveredTitle(toolCall.title, "Fetch"),
    };
  }

  if (looksLikeOpenCodeShellTitle(toolCall.title)) {
    return { ...toolCall, kind: "shell" };
  }

  return null;
}

function resolveOpenCodeInputRecord(toolCall: AgentToolCall, source: any) {
  return parseJsonRecord(
    source?.rawInput ??
      source?.raw_input ??
      source?.input ??
      source?.state?.input ??
      toolCall.input,
  );
}

function resolveOpenCodeSearchLabel(descriptor: string) {
  const normalized = descriptor.trim();
  if (/\bglob\b/iu.test(normalized)) {
    return "Glob";
  }
  if (/\bgrep\b/iu.test(normalized)) {
    return "Grep";
  }
  if (/ast[_ -]?grep/iu.test(normalized)) {
    return "AST search";
  }
  return "Search";
}

function resolveOpenCodeStructuredTitle(
  toolCall: AgentToolCall,
  streamingTitle: string,
  finalTitle: string,
) {
  return isOpenCodeInputStreaming(toolCall.status) ? streamingTitle : finalTitle;
}

function isOpenCodeInputStreaming(status: AgentToolCall["status"]) {
  return status === "pending" || status === "running";
}

function compactOpenCodePath(path: string) {
  const workspacePath = path.match(
    /(?:^|[\\/])((?:apps|packages|docs|scripts)[\\/].*)$/u,
  )?.[1];
  return workspacePath ?? path;
}

function resolveOpenCodePathTitle(title: string, path: string) {
  return compactOpenCodePath(/[\\/]/u.test(title) ? title : path);
}

function truncateOpenCodeTitle(value: string, maxLength = 72) {
  const compact = compactOpenCodeTitle(value);
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function compactOpenCodeTitle(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function looksLikeOpenCodeLiveSubagentInput(
  title: string,
  input: Record<string, unknown> | null,
) {
  if (!input) {
    return false;
  }
  const prompt = firstString(input.prompt, input.description, input.message);
  const category = firstString(input.category, input.requested_subagent_type, input.requestedSubagentType);
  const hasLoadSkills = Array.isArray(input.load_skills) || Array.isArray(input.loadSkills);
  const hasBackgroundFlag =
    typeof input.run_in_background === "boolean" ||
    typeof input.runInBackground === "boolean";
  if (prompt && hasBackgroundFlag) {
    return true;
  }
  if (!/^task$/iu.test(title.trim())) {
    return false;
  }
  return Boolean(prompt && (category || hasLoadSkills || hasBackgroundFlag));
}

function looksLikeOpenCodeCompletedSubagent(
  metadata: Record<string, unknown> | null,
  outputText: string | undefined,
) {
  if (metadata) {
    const prompt = firstString(metadata.prompt, metadata.description);
    const taskId = firstString(metadata.taskId, metadata.task_id);
    const sessionId = firstString(metadata.sessionId, metadata.session_id);
    const agent = firstString(metadata.agent, metadata.agent_name, metadata.agentName);
    const requestedType = firstString(
      metadata.requested_subagent_type,
      metadata.requestedSubagentType,
      metadata.subagent_type,
      metadata.subagentType,
      metadata.category,
    );
    const hasSpawnDepth =
      typeof metadata.spawnDepth === "number" ||
      typeof metadata.spawn_depth === "number";
    const hasBackgroundFlag =
      typeof metadata.run_in_background === "boolean" ||
      typeof metadata.runInBackground === "boolean";
    if (prompt && (taskId || sessionId) && hasBackgroundFlag) {
      return true;
    }
    if (prompt && (taskId || sessionId) && (agent || requestedType || hasSpawnDepth)) {
      return true;
    }
  }

  if (!outputText) {
    return false;
  }
  return /<task_metadata>[\s\S]*?(?:task_id|session_id):/iu.test(outputText) &&
    /\bto continue:\s*task\(/iu.test(outputText);
}

function resolveOpenCodeSubagentTitle(
  currentTitle: string,
  input: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
) {
  if (!/^task$/iu.test(currentTitle.trim())) {
    return currentTitle;
  }
  return firstString(
    metadata?.description,
    input?.description,
    metadata?.prompt,
    input?.prompt,
  ) ?? currentTitle;
}

function looksLikeOpenCodeWriteOutput(outputText: string | undefined) {
  if (!outputText) {
    return false;
  }
  return /^Wrote file successfully\./u.test(outputText) ||
    /^Edit applied successfully\./u.test(outputText) ||
    /^\[DRY RUN\]\s+\d+\s+replacement\(s\):/u.test(outputText) ||
    /^No matches found to replace\b/u.test(outputText);
}

function looksLikeOpenCodeSessionInfoOutput(outputText: string | undefined) {
  if (!outputText) {
    return false;
  }
  return /^Session ID:\s+\S+/mu.test(outputText) &&
    /^Messages:\s+\d+/mu.test(outputText);
}

function looksLikeOpenCodeSessionListOutput(outputText: string | undefined) {
  if (!outputText) {
    return false;
  }
  return /^\|\s*Session ID\s*\|\s*Messages\s*\|/mu.test(outputText);
}

function looksLikeOpenCodeDiagnosticsOutput(outputText: string | undefined) {
  if (!outputText) {
    return false;
  }
  return /^No diagnostics found$/mu.test(outputText);
}

function looksLikeOpenCodeSymbolListOutput(outputText: string | undefined) {
  if (!outputText) {
    return false;
  }
  const lines = outputText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return false;
  }
  const symbolLineCount = lines.filter((line) =>
    /^[^\r\n]+ \((?:Constant|Variable|Function|Class|Interface|Type|Enum|Method|Property)\) - line \d+$/u.test(line)
  ).length;
  return symbolLineCount >= Math.min(3, lines.length);
}

function looksLikeOpenCodeSearchOutput(
  outputText: string | undefined,
  outputRecord: Record<string, unknown> | null,
  nestedOutputRecord: Record<string, unknown> | null,
) {
  if (
    outputText &&
    (
      /^Found \d+ match\(es\)/u.test(outputText) ||
      /^No matches found\b/u.test(outputText) ||
      /\bperformed search on repository:/iu.test(outputText) ||
      /^[A-Za-z]:[\\/].+:\d+:\d+(?:\r?\n|$)/mu.test(outputText)
    )
  ) {
    return true;
  }
  return looksLikeOpenCodeStructuredSearchRecord(outputRecord) ||
    looksLikeOpenCodeStructuredSearchRecord(nestedOutputRecord);
}

function looksLikeOpenCodeStructuredSearchRecord(record: Record<string, unknown> | null) {
  if (!record) {
    return false;
  }
  if (
    Array.isArray(record.files) ||
    Array.isArray(record.dirs) ||
    (Array.isArray(record.results) && typeof record.query === "string")
  ) {
    return true;
  }
  const entries = Object.entries(record);
  if (!entries.length) {
    return false;
  }
  return entries.every(([key, value]) =>
    /[\\/]/u.test(key) &&
    (Array.isArray(value) || typeof value === "string"),
  );
}

function looksLikeOpenCodeShellTitle(title: string) {
  const normalized = title.trim();
  if (!normalized || isOpaqueOpenCodeToolTitle(normalized)) {
    return false;
  }
  return /[|><;&]/u.test(normalized) ||
    /^(?:Get|Set|Add|Remove|Select|Where|ForEach|Measure|Sort|Out|Join|Split|Copy|Move|Rename|Test)-[A-Za-z]/u.test(normalized) ||
    /^(?:git|pnpm|npm|node|powershell|pwsh|cmd|bash|ls|cat|sed|awk|python|tsc)\b/iu.test(normalized);
}

function looksLikeOpenCodeFetchOutput(
  title: string,
  outputText: string | undefined,
  nestedOutputRecord: Record<string, unknown> | null,
) {
  if (/^https?:\/\//iu.test(title.trim())) {
    return true;
  }
  if (outputText && /^Title:\s.+\nURL:\shttps?:\/\//u.test(outputText)) {
    return true;
  }
  return Boolean(
    nestedOutputRecord &&
      Array.isArray(nestedOutputRecord.results) &&
      typeof nestedOutputRecord.query === "string",
  );
}

function resolveOpenCodeSkillTitle(outputText: string | undefined) {
  if (!outputText) {
    return undefined;
  }
  const match = outputText.match(/^## Skill:\s+(.+)$/mu);
  if (!match?.[1]) {
    return undefined;
  }
  return `Skill: ${match[1].trim()}`;
}

function extractTaggedOutputValue(outputText: string | undefined, tagName: string) {
  if (!outputText) {
    return undefined;
  }
  const match = outputText.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "iu"));
  return match?.[1]?.trim() || undefined;
}

function preferOpenCodeRecoveredTitle(currentTitle: string, fallbackTitle: string) {
  return isOpaqueOpenCodeToolTitle(currentTitle) ? fallbackTitle : currentTitle;
}

function isOpaqueOpenCodeToolTitle(title: string) {
  const normalized = title.trim();
  return !normalized ||
    /^Tool call\b/iu.test(normalized) ||
    /^call_[A-Za-z0-9]+$/u.test(normalized);
}

function resolveOpenCodeSource(update: unknown): Record<string, unknown> {
  const envelope = recordFrom(update) ?? {};
  const nested = recordFrom(envelope.toolCall ?? envelope.tool_call);
  if (!nested) {
    return envelope;
  }

  const source: Record<string, unknown> = { ...nested, ...envelope };
  for (const key of [
    "rawInput",
    "raw_input",
    "input",
    "rawOutput",
    "raw_output",
    "output",
    "result",
    "content",
    "text",
    "metadata",
  ]) {
    if (!hasMeaningfulOpenCodeValue(source[key]) && nested[key] !== undefined) {
      source[key] = nested[key];
    }
  }
  return source;
}

function parseJsonRecord(input: unknown) {
  const parsed = parseOpenCodeValue(input);
  const direct = recordFrom(parsed);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  return collectOpenCodeRecords(parsed)
    .sort((left, right) => openCodeRecordScore(right) - openCodeRecordScore(left))[0] ?? null;
}

function recordFrom(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseOpenCodeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function collectOpenCodeRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8) {
    return [];
  }
  const parsed = parseOpenCodeValue(value);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => collectOpenCodeRecords(item, depth + 1));
  }
  const record = recordFrom(parsed);
  if (!record) {
    return [];
  }
  const records = [record];
  for (const key of ["metadata", "output", "result", "content", "data", "value", "text"]) {
    if (record[key] !== undefined) {
      records.push(...collectOpenCodeRecords(record[key], depth + 1));
    }
  }
  return records;
}

function resolveOpenCodeMetadata(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    for (const record of collectOpenCodeRecords(value)) {
      const metadata = recordFrom(record.metadata);
      if (metadata) {
        return metadata;
      }
      if (looksLikeOpenCodeMetadataRecord(record)) {
        return record;
      }
    }
  }
  return null;
}

function looksLikeOpenCodeMetadataRecord(record: Record<string, unknown>) {
  const hasIdentity = [
    "taskId",
    "task_id",
    "backgroundTaskId",
    "background_task_id",
    "sessionId",
    "session_id",
  ].some((key) => typeof record[key] === "string" && Boolean((record[key] as string).trim()));
  const hasPrompt = typeof record.prompt === "string" || typeof record.description === "string";
  const hasAgent = [
    "agent",
    "agentName",
    "agent_name",
    "category",
    "requestedSubagentType",
    "requested_subagent_type",
    "subagentType",
    "subagent_type",
  ].some((key) => typeof record[key] === "string" && Boolean((record[key] as string).trim()));
  return hasIdentity || (hasPrompt && hasAgent);
}

function firstOpenCodeText(...values: unknown[]) {
  for (const value of values) {
    const text = openCodeText(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function openCodeText(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = parseOpenCodeValue(trimmed);
    if (parsed === value) {
      return trimmed;
    }
    return openCodeText(parsed, depth + 1) ?? trimmed;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => openCodeText(item, depth + 1))
      .filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("\n\n") : undefined;
  }
  const record = recordFrom(value);
  if (!record) {
    return undefined;
  }
  for (const key of ["text", "content", "output", "result", "message", "value", "data"]) {
    const text = openCodeText(record[key], depth + 1);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function extractOpenCodeId(text: string | undefined, namePattern: string) {
  if (!text) {
    return undefined;
  }
  const match = text.match(new RegExp(
    `(?:^|[\\s<(])${namePattern}\\s*[:=]\\s*["']?([A-Za-z0-9._:-]+)`,
    "imu",
  ));
  return match?.[1]?.replace(/[),.;"']+$/u, "") || undefined;
}

function hasMeaningfulOpenCodeValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function openCodeRecordScore(record: Record<string, unknown>) {
  const weights: Array<[string, number]> = [
    ["metadata", 10],
    ["output", 5],
    ["result", 5],
    ["prompt", 4],
    ["description", 4],
    ["taskId", 3],
    ["task_id", 3],
    ["sessionId", 3],
    ["session_id", 3],
    ["files", 2],
    ["results", 2],
    ["resources", 2],
    ["query", 1],
    ["text", 1],
    ["type", 1],
  ];
  return weights.reduce((score, [key, weight]) => score + (key in record ? weight : 0), 0);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function stringifyRecord(record: Record<string, unknown> | null) {
  if (!record) {
    return undefined;
  }
  try {
    return JSON.stringify(record);
  } catch {
    return undefined;
  }
}
