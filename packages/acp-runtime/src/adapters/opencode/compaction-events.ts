import type { SessionRuntimeEvent } from "../../runtime-types";

const OPENCODE_COMPACTION_SUMMARY_LAYOUTS = [
  [
    "## Objective",
    "## Important Details",
    "## Work State",
    "### Completed",
    "### Active",
    "### Blocked",
    "## Next Move",
    "## Relevant Files",
  ],
  [
    "## Goal",
    "## Constraints & Preferences",
    "## Progress",
    "### Done",
    "### In Progress",
    "### Blocked",
    "## Key Decisions",
    "## Next Steps",
    "## Critical Context",
    "## Relevant Files",
  ],
] as const;

export function expandOpenCodeRuntimeEvent(
  event: SessionRuntimeEvent,
): SessionRuntimeEvent[] | null {
  if (event.type !== "message" || event.message.role !== "assistant") {
    return null;
  }
  if (event.message.streaming === true) {
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
  const normalized = text.trim();
  return OPENCODE_COMPACTION_SUMMARY_LAYOUTS.some((layout) =>
    matchesSummaryLayout(normalized, layout),
  );
}

function matchesSummaryLayout(
  text: string,
  headings: readonly string[],
): boolean {
  const lines = text.split(/\r?\n/u).map((line) => line.trimEnd());
  const actualHeadings = lines.filter(
    (line) => line.startsWith("## ") || line.startsWith("### "),
  );
  return (
    lines[0] === headings[0] &&
    actualHeadings.length === headings.length &&
    actualHeadings.every((heading, index) => heading === headings[index])
  );
}
