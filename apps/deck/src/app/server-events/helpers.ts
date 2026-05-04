import type {
  AvailableCommand,
  CommandChunk,
  SessionSummary,
} from "@tiller/shared";

export function availableCommandListsEqual(
  left: AvailableCommand[] | undefined,
  right: AvailableCommand[],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.name !== b.name ||
      a.description !== b.description ||
      a.input?.hint !== b.input?.hint
    ) {
      return false;
    }
  }
  return true;
}

export function removeSessionRecord<T>(
  records: Record<string, T>,
  sessionId: string,
) {
  const { [sessionId]: _removed, ...rest } = records;
  return rest;
}

export function mergeSessionSummaries(
  current: SessionSummary[],
  incoming: SessionSummary[],
) {
  const byId = new Map(
    current.map((session) => [session.id, session] as const),
  );
  incoming.forEach((session) => byId.set(session.id, session));
  return Array.from(byId.values()).sort((left, right) => {
    const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    const createdDelta = right.createdAt.localeCompare(left.createdAt);
    return createdDelta === 0 ? left.id.localeCompare(right.id) : createdDelta;
  });
}

export function mergeCommandHistory(
  current: CommandChunk[],
  incoming: CommandChunk[],
) {
  const merged = [...current];
  for (const chunk of incoming) {
    if (!merged.some((item) => item.id === chunk.id)) {
      merged.push(chunk);
    }
  }

  return merged.sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
}

export function upsertSessionSummary(
  current: SessionSummary[],
  incoming: SessionSummary,
) {
  return [
    ...current.filter((session) => session.id !== incoming.id),
    incoming,
  ].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}
