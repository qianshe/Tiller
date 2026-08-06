import type { AgentToolCall } from "@tiller/shared";

export type ToolCallChangeStats = {
  additions: number;
  deletions: number;
};

export type ToolCallDiff = {
  path?: string;
  patch: string;
};

const MAX_NESTED_RECORDS = 16;
const MAX_STATS_SOURCE_CHARS = 512 * 1024;

export function resolveToolCallChangeStats(
  kind: AgentToolCall["kind"],
  input: string,
  output: string,
): ToolCallChangeStats | undefined {
  if (kind !== "write") {
    return undefined;
  }

  const creationStats = readCreationStats(input, output);
  if (creationStats) {
    return creationStats;
  }

  const acpDiffStats = readAcpDiffContentStats(input, output);
  if (acpDiffStats) {
    return acpDiffStats;
  }

  const codexApplyPatchStats = readCodexApplyPatchStats(input, output);
  if (codexApplyPatchStats) {
    return codexApplyPatchStats;
  }

  for (const source of [input, output]) {
    const root = parseJsonValue(source);
    if (root === undefined) {
      continue;
    }
    for (const record of collectNestedRecords(root)) {
      const stats =
        readExplicitStats(record) ??
        readPatchStats(record) ??
        readReplacementStats(record);
      if (stats) {
        return stats;
      }
    }
  }

  return undefined;
}

export function resolveToolCallDiff(
  kind: AgentToolCall["kind"],
  input: string,
  output: string,
): ToolCallDiff | undefined {
  if (kind !== "write") {
    return undefined;
  }

  const codexPatch = readCodexApplyPatch(input, output);
  if (codexPatch) {
    const patch = formatCodexApplyPatch(codexPatch);
    return patch
      ? { path: extractApplyPatchPath(codexPatch), patch }
      : undefined;
  }

  for (const source of [input, output]) {
    const root = parseJsonValue(source);
    if (root === undefined) {
      continue;
    }
    const rootRecord = asRecord(root);
    const rootPath = rootRecord ? readFilePath(rootRecord) : undefined;
    for (const record of collectNestedRecords(root)) {
      const patch = readPatch(record);
      if (patch) {
        return {
          path: readFilePath(record) ?? rootPath ?? extractUnifiedPatchPath(patch),
          patch,
        };
      }
      const replacement = buildReplacementPatch(record);
      if (replacement) {
        return {
          path: readFilePath(record) ?? rootPath,
          patch: replacement,
        };
      }
    }
  }

  return readCreationDiff(input, output);
}

function readAcpDiffContentStats(
  input: string,
  output: string,
): ToolCallChangeStats | undefined {
  let additions = 0;
  let deletions = 0;
  let found = false;

  for (const source of [input, output]) {
    const root = parseJsonValue(source);
    if (root === undefined) {
      continue;
    }
    for (const record of collectNestedRecords(root)) {
      if (record.type !== "diff") {
        continue;
      }
      const stats = readReplacementStats(record);
      if (!stats) {
        continue;
      }
      additions += stats.additions;
      deletions += stats.deletions;
      found = true;
    }
  }

  return found ? { additions, deletions } : undefined;
}

function readCodexApplyPatchStats(
  input: string,
  output: string,
): ToolCallChangeStats | undefined {
  const patch = readCodexApplyPatch(input, output);
  return patch ? countApplyPatchLines(patch) : undefined;
}

function readCodexApplyPatch(
  input: string,
  output: string,
): string | undefined {
  if (!hasSuccessfulCodexApplyPatchOutput(output)) {
    return undefined;
  }
  const record = parseRecord(input);
  const command = record ? extractCommand(record) : input;
  if (
    !command ||
    !/(?:^|[\s;&|])apply_patch(?:\.bat)?\b|--codex-run-as-apply-patch\b/iu.test(command)
  ) {
    return undefined;
  }

  const normalized = command.replace(/`r`n|`n|`r/gu, "\n");
  const patchStart = normalized.indexOf("*** Begin Patch");
  const patchEnd = normalized.indexOf("*** End Patch", patchStart);
  if (patchStart < 0 || patchEnd < 0) {
    return undefined;
  }

  return normalized.slice(patchStart, patchEnd);
}

function formatCodexApplyPatch(patch: string) {
  return patch
    .split(/\r?\n/u)
    .filter((line) => !/^\*\*\* (?:Begin Patch|Add File:|Update File:|Delete File:|Move to:)/u.test(line))
    .join("\n")
    .replace(/\n+$/u, "");
}

function extractApplyPatchPath(patch: string) {
  return patch.match(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/mu)?.[1]?.trim();
}

function hasSuccessfulCodexApplyPatchOutput(output: string) {
  const record = parseRecord(output);
  if (!record) {
    return /Success\. Updated the following files:/u.test(output);
  }
  return [
    record.stdout,
    record.aggregated_output,
    record.formatted_output,
    record.output,
  ].some((value) =>
    typeof value === "string" &&
    /Success\. Updated the following files:/u.test(value)
  );
}

function extractCommand(record: Record<string, unknown>) {
  const parsedCommand = Array.isArray(record.parsed_cmd)
    ? record.parsed_cmd.find((value) =>
      typeof asRecord(value)?.cmd === "string"
    )
    : undefined;
  const command = asRecord(parsedCommand)?.cmd ??
    record.command ??
    record.cmd ??
    record.script ??
    record.shell ??
    record.args;
  if (Array.isArray(command)) {
    return command.map((value) => String(value)).join(" ");
  }
  return typeof command === "string" ? command : undefined;
}

function countApplyPatchLines(
  patch: string,
): ToolCallChangeStats | undefined {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return additions > 0 || deletions > 0 ? { additions, deletions } : undefined;
}

function readCreationDiff(
  input: string,
  output: string,
): ToolCallDiff | undefined {
  if (!hasFileCreationEvidence(output)) {
    return undefined;
  }
  const record = parseRecord(input);
  const content = record?.content ?? record?.newText ?? record?.new_text;
  if (typeof content !== "string") {
    return undefined;
  }
  const patch = splitContentLines(content).map((line) => `+${line}`).join("\n");
  return patch ? { path: record ? readFilePath(record) : undefined, patch } : undefined;
}

function readCreationStats(
  input: string,
  output: string,
): ToolCallChangeStats | undefined {
  if (!hasFileCreationEvidence(output)) {
    return undefined;
  }
  const record = parseRecord(input);
  const content = record?.content ?? record?.newText ?? record?.new_text;
  if (typeof content !== "string") {
    return undefined;
  }
  const additions = splitContentLines(content).length;
  return additions > 0 ? { additions, deletions: 0 } : undefined;
}

function hasFileCreationEvidence(output: string) {
  if (
    /"(?:oldText|old_text|originalFile|original_file)"\s*:\s*null/iu.test(output) ||
    /"(?:type|operation)"\s*:\s*"create"/iu.test(output)
  ) {
    return true;
  }

  const root = parseJsonValue(output);
  return root !== undefined && collectNestedRecords(root).some((record) =>
    record.exists === false &&
    typeof (record.filepath ?? record.filePath) === "string",
  );
}

function parseRecord(value: string): Record<string, unknown> | undefined {
  return asRecord(parseJsonValue(value));
}

function parseJsonValue(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    (!trimmed.startsWith("{") && !trimmed.startsWith("[")) ||
    trimmed.length > MAX_STATS_SOURCE_CHARS
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function collectNestedRecords(root: unknown) {
  const records: Record<string, unknown>[] = [];
  const queue: unknown[] = [root];
  while (queue.length > 0 && records.length < MAX_NESTED_RECORDS) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, MAX_NESTED_RECORDS - records.length));
      continue;
    }
    const record = asRecord(value);
    if (!record) {
      continue;
    }
    records.push(record);
    for (const value of Object.values(record)) {
      const nested = asRecord(value);
      if (nested) {
        queue.push(nested);
      }
    }
  }
  return records;
}

function readExplicitStats(
  record: Record<string, unknown>,
): ToolCallChangeStats | undefined {
  const additions = readNonNegativeInteger(record.additions);
  const deletions = readNonNegativeInteger(record.deletions);
  return additions !== undefined && deletions !== undefined
    ? { additions, deletions }
    : undefined;
}

function readPatchStats(
  record: Record<string, unknown>,
): ToolCallChangeStats | undefined {
  const patch = readPatch(record);
  return patch ? countPatchLines(patch) : undefined;
}

function readPatch(record: Record<string, unknown>) {
  for (const key of ["patch", "diff", "hunk", "code_edit", "unified_diff", "unifiedDiff"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function countPatchLines(patch: string): ToolCallChangeStats | undefined {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return additions > 0 || deletions > 0 ? { additions, deletions } : undefined;
}

function readReplacementStats(
  record: Record<string, unknown>,
): ToolCallChangeStats | undefined {
  const change = readReplacementChange(record);
  if (!change) {
    return undefined;
  }
  const stats = {
    additions: change.newLines.length - change.prefix - change.suffix,
    deletions: change.oldLines.length - change.prefix - change.suffix,
  };
  return stats.additions > 0 || stats.deletions > 0 ? stats : undefined;
}

function buildReplacementPatch(record: Record<string, unknown>) {
  const change = readReplacementChange(record);
  if (!change) {
    return undefined;
  }
  const oldEnd = change.oldLines.length - change.suffix;
  const newEnd = change.newLines.length - change.suffix;
  const oldChanged = change.oldLines.slice(change.prefix, oldEnd);
  const newChanged = change.newLines.slice(change.prefix, newEnd);
  if (oldChanged.length === 0 && newChanged.length === 0) {
    return undefined;
  }
  return [
    `@@ -${change.prefix + 1},${oldChanged.length} +${change.prefix + 1},${newChanged.length} @@`,
    ...oldChanged.map((line) => `-${line}`),
    ...newChanged.map((line) => `+${line}`),
  ].join("\n");
}

function readReplacementChange(record: Record<string, unknown>) {
  const oldText = readTextSnapshot(record, ["old_string", "oldString", "old_text", "oldText"]);
  const newText = readTextSnapshot(record, ["new_string", "newString", "new_text", "newText"]);
  if (oldText === undefined || newText === undefined) {
    return undefined;
  }

  const oldLines = splitContentLines(oldText);
  const newLines = splitContentLines(newText);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return { oldLines, newLines, prefix, suffix };
}

function readTextSnapshot(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const value = record[key];
    if (value === null) {
      return "";
    }
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function readFilePath(record: Record<string, unknown>) {
  const value = record.file_path ??
    record.filePath ??
    record.path ??
    record.relative_path ??
    record.relativePath ??
    record.notebook_path ??
    record.notebookPath;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractUnifiedPatchPath(patch: string) {
  const match = patch.match(/^\+\+\+\s+(?:b\/)?(.+?)\s*$/mu) ??
    patch.match(/^---\s+(?:a\/)?(.+?)\s*$/mu);
  const path = match?.[1]?.trim();
  return path && path !== "/dev/null" ? path : undefined;
}

function splitContentLines(value: string) {
  if (!value) {
    return [];
  }
  const lines = value.replace(/\r\n/gu, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
