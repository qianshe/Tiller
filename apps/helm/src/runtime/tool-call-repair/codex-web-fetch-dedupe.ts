import type { AgentToolCall } from "@tiller/shared";

export function dedupeCodexWebFetchToolCalls(
  providerId: string | undefined,
  toolCalls: AgentToolCall[],
) {
  if (providerId !== "codex") {
    return toolCalls;
  }

  const transcriptQueries = new Set(
    toolCalls
      .map(extractCodexTranscriptWebFetchQuery)
      .filter((value): value is string => Boolean(value)),
  );
  if (!transcriptQueries.size) {
    return toolCalls;
  }

  let changed = false;
  const deduped = toolCalls.filter((toolCall) => {
    const replayQuery = extractCodexReplayWebFetchQuery(toolCall);
    if (!replayQuery || !transcriptQueries.has(replayQuery)) {
      return true;
    }
    changed = true;
    return false;
  });
  return changed ? deduped : toolCalls;
}

function extractCodexTranscriptWebFetchQuery(toolCall: AgentToolCall) {
  if (!/^ws_/u.test(toolCall.id.trim()) || toolCall.kind !== "fetch") {
    return null;
  }
  return normalizeCodexWebFetchQuery(
    readQueryFromInput(toolCall.input) ??
      readQueryFromSearchingTitle(toolCall.title),
  );
}

function extractCodexReplayWebFetchQuery(toolCall: AgentToolCall) {
  if (!/^web_search_/u.test(toolCall.id.trim())) {
    return null;
  }
  if (toolCall.kind !== "fetch" && toolCall.kind !== "search") {
    return null;
  }
  return normalizeCodexWebFetchQuery(
    readQueryFromInput(toolCall.input) ??
      toolCall.title,
  );
}

function readQueryFromInput(input: string | undefined) {
  const parsed = parseJsonRecord(input);
  const query = parsed?.query;
  return typeof query === "string" && query.trim() ? query.trim() : undefined;
}

function readQueryFromSearchingTitle(title: string) {
  const match = title.trim().match(/^Searching for:\s*(.+)$/iu);
  return match?.[1]?.trim() || undefined;
}

function normalizeCodexWebFetchQuery(query: string | undefined) {
  if (!query) {
    return null;
  }
  return query.trim().replace(/\s+/gu, " ").toLowerCase();
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
