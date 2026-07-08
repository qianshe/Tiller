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
