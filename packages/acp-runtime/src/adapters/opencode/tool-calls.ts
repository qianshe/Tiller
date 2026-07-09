import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";

export function normalizeOpenCodeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const subagent = normalizeOpenCodeSubagentToolCall(toolCall, source);
  if (subagent) {
    return subagent;
  }
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: source?.rawInput ?? source?.raw_input ?? source?.input ?? source?.state?.input ?? toolCall.input,
    title: toolCall.title,
    rawTitle: typeof toolCall.title === "string" ? toolCall.title : undefined,
  });
  if (mcp) {
    return { ...toolCall, kind: "mcp", title: formatAgentToolCallMcpTitle(mcp), mcp };
  }
  const inferred = normalizeOpenCodeOpaqueToolCall(toolCall, source);
  if (inferred) {
    return inferred;
  }
  return toolCall;
}

function normalizeOpenCodeSubagentToolCall(
  toolCall: AgentToolCall,
  source: any,
): AgentToolCall | null {
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
  const outputMetadata =
    recordFrom(outputRecord?.metadata) ??
    recordFrom(source?.metadata) ??
    recordFrom(source?.state?.metadata);
  const outputText = firstString(
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

  return {
    ...toolCall,
    kind: "subagent",
    title,
    ...(normalizedInput ? { input: normalizedInput } : {}),
  };
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
  const outputMetadata =
    recordFrom(outputRecord?.metadata) ??
    recordFrom(source?.metadata) ??
    recordFrom(source?.state?.metadata);
  const displayMetadata = recordFrom(outputMetadata?.display);
  const outputText = firstString(
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
    return { ...toolCall, kind: "skill", title: skillTitle };
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
      kind: "read",
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

function looksLikeOpenCodeLiveSubagentInput(
  title: string,
  input: Record<string, unknown> | null,
) {
  if (!/^task$/iu.test(title.trim()) || !input) {
    return false;
  }
  const prompt = firstString(input.prompt, input.description, input.message);
  const category = firstString(input.category, input.requested_subagent_type, input.requestedSubagentType);
  const hasLoadSkills = Array.isArray(input.load_skills) || Array.isArray(input.loadSkills);
  const hasBackgroundFlag =
    typeof input.run_in_background === "boolean" ||
    typeof input.runInBackground === "boolean";
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

function parseJsonRecord(input: unknown) {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return recordFrom(parsed);
    } catch {
      return null;
    }
  }
  return recordFrom(input);
}

function recordFrom(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
