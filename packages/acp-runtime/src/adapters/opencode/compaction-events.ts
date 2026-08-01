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
const OPENCODE_LEGACY_COMPACTION_INTRO =
  /^Done\.\s+Here is the updated summary\.\s*$/iu;
const OPENCODE_LEGACY_COMPACTION_SECTIONS = [
  "1. User Requests (As-Is)",
  "2. Final Goal",
  "3. Work Completed",
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
  if (looksLikeLegacyOpenCodeCompactionSummary(text)) {
    return true;
  }
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

function looksLikeLegacyOpenCodeCompactionSummary(text: string): boolean {
  const lines = text.trim().split(/\r?\n/u).map((line) => line.trim());
  if (!OPENCODE_LEGACY_COMPACTION_INTRO.test(lines[0] ?? "")) {
    return false;
  }
  let sectionIndex = 0;
  for (const line of lines.slice(1)) {
    if (line === OPENCODE_LEGACY_COMPACTION_SECTIONS[sectionIndex]) {
      sectionIndex += 1;
      if (sectionIndex === OPENCODE_LEGACY_COMPACTION_SECTIONS.length) {
        return true;
      }
    }
  }
  return false;
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
