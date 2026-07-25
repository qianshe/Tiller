import type { MissionPromptContextItem } from "@tiller/shared";

export type ParsedDiffLine = {
  displayLineNumber: number;
  kind: "added" | "context" | "deleted" | "hunk";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export function parseDiffPatchLines(patch: string): ParsedDiffLine[] {
  const lines = patch.split(/\r?\n/u);
  const parsed: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let display = 1;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      parsed.push({ displayLineNumber: display++, kind: "hunk", text: line });
      continue;
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("-")) {
      parsed.push({ displayLineNumber: display++, kind: "deleted", text: line, oldLineNumber: oldLine++ });
      continue;
    }
    if (line.startsWith("+")) {
      parsed.push({ displayLineNumber: display++, kind: "added", text: line, newLineNumber: newLine++ });
      continue;
    }
    parsed.push({
      displayLineNumber: display++,
      kind: "context",
      text: line,
      oldLineNumber: oldLine++,
      newLineNumber: newLine++,
    });
  }

  return parsed;
}

export function diffLineKey(line: ParsedDiffLine) {
  // 语义键:只看 kind + 真实行号(old/new),不看 displayLineNumber。
  // patch 内容微调时 display 编号漂移会导致旧 key 找不到新行 → 选区静默失效。
  return `${line.kind}:${line.oldLineNumber ?? "_"}:${line.newLineNumber ?? "_"}`;
}

export function selectContiguousDiffLines(
  lines: ParsedDiffLine[],
  anchorKey: string,
  targetKey: string,
) {
  const anchorIndex = lines.findIndex((line) => diffLineKey(line) === anchorKey);
  const targetIndex = lines.findIndex((line) => diffLineKey(line) === targetKey);
  if (anchorIndex === -1 || targetIndex === -1) {
    return [];
  }
  const [start, end] = anchorIndex <= targetIndex
    ? [anchorIndex, targetIndex]
    : [targetIndex, anchorIndex];
  return lines.slice(start, end + 1).filter((line) => line.kind !== "hunk");
}

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
