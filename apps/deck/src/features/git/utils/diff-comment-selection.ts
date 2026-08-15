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
