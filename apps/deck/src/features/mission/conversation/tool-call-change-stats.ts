import type { AgentToolCall } from "@tiller/shared";

export type ToolCallChangeStats = {
  additions: number;
  deletions: number;
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

  const codexApplyPatchStats = readCodexApplyPatchStats(input, output);
  if (codexApplyPatchStats) {
    return codexApplyPatchStats;
  }

  for (const source of [input, output]) {
    const root = parseRecord(source);
    if (!root) {
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

function readCodexApplyPatchStats(
  input: string,
  output: string,
): ToolCallChangeStats | undefined {
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

  return countApplyPatchLines(normalized.slice(patchStart, patchEnd));
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
  return /"(?:oldText|old_text|originalFile|original_file)"\s*:\s*null/iu.test(output) ||
    /"(?:type|operation)"\s*:\s*"create"/iu.test(output);
}

function parseRecord(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || trimmed.length > MAX_STATS_SOURCE_CHARS) {
    return undefined;
  }
  try {
    return asRecord(JSON.parse(trimmed) as unknown);
  } catch {
    return undefined;
  }
}

function collectNestedRecords(root: Record<string, unknown>) {
  const records: Record<string, unknown>[] = [];
  const queue: Record<string, unknown>[] = [root];
  while (queue.length > 0 && records.length < MAX_NESTED_RECORDS) {
    const record = queue.shift();
    if (!record) {
      break;
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
  for (const key of ["patch", "diff", "hunk", "code_edit"]) {
    const value = record[key];
    if (typeof value !== "string") {
      continue;
    }
    const stats = countPatchLines(value);
    if (stats) {
      return stats;
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
  const oldText = record.old_string ?? record.oldString;
  const newText = record.new_string ?? record.newString;
  if (typeof oldText !== "string" || typeof newText !== "string") {
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

  const stats = {
    additions: newLines.length - prefix - suffix,
    deletions: oldLines.length - prefix - suffix,
  };
  return stats.additions > 0 || stats.deletions > 0 ? stats : undefined;
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
