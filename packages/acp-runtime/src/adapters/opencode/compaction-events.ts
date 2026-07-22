import type { SessionRuntimeEvent } from "../../runtime-types";

const OPENCODE_COMPACTION_CORE_HEADING_GROUPS = [
  ["## Objective", "## Goal"],
  ["## Work State", "## Progress"],
  ["### Completed", "### Done"],
  ["### Active", "### In Progress"],
  ["### Blocked"],
  ["## Next Move", "## Next Steps"],
  ["## Relevant Files"],
] as const;

export function expandOpenCodeRuntimeEvent(
  event: SessionRuntimeEvent,
): SessionRuntimeEvent[] | null {
  if (event.type !== "message" || event.message.role !== "assistant") {
    return null;
  }
  if (event.message.streaming !== false) {
    return null;
  }
  if (!looksLikeOpenCodeCompactionSummary(event.message.text)) {
    return null;
  }
  return [
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: event.message.id,
      timestamp: event.message.timestamp,
      summaryText: event.message.text,
    },
  ];
}

function looksLikeOpenCodeCompactionSummary(text: string): boolean {
  const headings = extractOpenCodeCompactionHeadings(text);
  if (headings.length === 0) {
    return false;
  }
  const entryGroup = OPENCODE_COMPACTION_CORE_HEADING_GROUPS[0];
  if (!(entryGroup as readonly string[]).includes(headings[0])) {
    return false;
  }
  return matchesOpenCodeCompactionCoreHeadings(headings);
}

function matchesOpenCodeCompactionCoreHeadings(headings: string[]): boolean {
  let groupIndex = 0;
  for (const heading of headings) {
    const group = OPENCODE_COMPACTION_CORE_HEADING_GROUPS[groupIndex];
    if (group && (group as readonly string[]).includes(heading)) {
      groupIndex += 1;
    }
  }
  return groupIndex === OPENCODE_COMPACTION_CORE_HEADING_GROUPS.length;
}

function extractOpenCodeCompactionHeadings(text: string): string[] {
  const lines = text.trim().split(/\r?\n/u).map((line) => line.trimEnd());
  const headings: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/u.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      headings.push(line);
    }
  }
  return headings;
}
