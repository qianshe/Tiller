import type { SessionTimelineEntry } from "@tiller/shared";

export type PositionedSessionTimelineEntry = {
  position: number;
  id: string;
  kind: SessionTimelineEntry["kind"];
  timestamp: string;
  payload: SessionTimelineEntry;
};

export function encodeTimelineBlock(entries: PositionedSessionTimelineEntry[]) {
  assertAscendingUniquePositions(entries);
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

export function decodeTimelineBlock(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const entries = trimmed.split(/\r?\n/u).map((line, index) => {
    try {
      return normalizePositionedEntry(JSON.parse(line), index + 1);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid timeline block")) {
        throw error;
      }
      throw new Error(`Invalid timeline block JSONL at line ${index + 1}`);
    }
  });
  assertAscendingUniquePositions(entries);
  return entries;
}

function normalizePositionedEntry(value: unknown, line: number): PositionedSessionTimelineEntry {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid timeline block entry at line ${line}`);
  }
  const candidate = value as Partial<PositionedSessionTimelineEntry>;
  const position = candidate.position;
  if (!Number.isInteger(position) || position === undefined || position < 0) {
    throw new Error(`Invalid timeline block position at line ${line}`);
  }
  if (!candidate.id || typeof candidate.id !== "string") {
    throw new Error(`Invalid timeline block id at line ${line}`);
  }
  if (!candidate.kind || typeof candidate.kind !== "string") {
    throw new Error(`Invalid timeline block kind at line ${line}`);
  }
  if (!candidate.timestamp || typeof candidate.timestamp !== "string") {
    throw new Error(`Invalid timeline block timestamp at line ${line}`);
  }
  if (!candidate.payload || typeof candidate.payload !== "object") {
    throw new Error(`Invalid timeline block payload at line ${line}`);
  }
  return candidate as PositionedSessionTimelineEntry;
}

function assertAscendingUniquePositions(entries: PositionedSessionTimelineEntry[]) {
  let previous = -1;
  for (const entry of entries) {
    if (!Number.isInteger(entry.position) || entry.position <= previous) {
      throw new Error("Timeline block entries must have ascending unique positions");
    }
    previous = entry.position;
  }
}
