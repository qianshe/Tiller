import type { MissionPromptContextItem } from "@tiller/shared";
import {
  diffLineKey,
  parseDiffPatchLines,
  selectContiguousDiffLines,
  type ParsedDiffLine,
} from "../../git";

export { diffLineKey, parseDiffPatchLines, selectContiguousDiffLines };
export type { ParsedDiffLine };

export function buildDiffLineRangeLabel(
  selectedLineKeys: ReadonlySet<string>,
  file: { patch?: string } | null,
): string {
  if (!file?.patch) return "";
  const visibleLines = parseDiffPatchLines(file.patch);
  const selected = visibleLines.filter((line) => selectedLineKeys.has(diffLineKey(line)));
  const lineNumbers = selected
    .flatMap((line) => [line.newLineNumber ?? line.oldLineNumber].filter((v): v is number => typeof v === "number"));
  if (lineNumbers.length === 0) return "";
  const start = Math.min(...lineNumbers);
  const end = Math.max(...lineNumbers);
  return start === end ? `L${start}` : `L${start}-${end}`;
}

export function buildDiffSelectionSnapshot(input: {
  filePath: string;
  selectedLines: ParsedDiffLine[];
  comment: string;
}): MissionPromptContextItem {
  const realLines = input.selectedLines
    .flatMap((line) => [line.newLineNumber ?? line.oldLineNumber].filter(
      (value): value is number => typeof value === "number",
    ));
  const startLine = realLines.length
    ? Math.min(...realLines)
    : input.selectedLines[0]?.displayLineNumber ?? 0;
  const endLine = realLines.length
    ? Math.max(...realLines)
    : input.selectedLines.at(-1)?.displayLineNumber ?? startLine;

  return {
    id: `diff:${input.filePath}:${startLine}-${endLine}`,
    kind: "diff",
    label: `${input.filePath}:${startLine}-${endLine}`,
    comment: input.comment.trim(),
    excerpt: input.selectedLines.map((line) => line.text).join("\n"),
    source: {
      kind: "diff",
      filePath: input.filePath,
      startLine,
      endLine,
    },
  };
}
