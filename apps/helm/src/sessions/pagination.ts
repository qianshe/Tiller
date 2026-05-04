export function normalizePageLimit(limit: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return fallback;
  }
  return Math.min(Math.floor(limit as number), max);
}

export function encodeCursor(...keys: Array<string | undefined>): string | undefined {
  if (keys.some((key) => !key)) {
    return undefined;
  }
  return keys.join("\t");
}

export function decodeCursor(
  cursor: string | undefined,
  expectedKeyCount: number,
): string[] | null {
  if (!cursor) {
    return null;
  }
  const parts = cursor.split("\t");
  if (parts.length !== expectedKeyCount || parts.some((part) => !part)) {
    return null;
  }
  return parts;
}

export function compareTimestampIdPosition(
  leftTimestamp: string,
  leftId: string,
  rightTimestamp: string,
  rightId: string,
) {
  const timestampDelta = Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return leftId.localeCompare(rightId);
}
