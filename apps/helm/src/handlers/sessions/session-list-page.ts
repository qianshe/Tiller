import { decodeCursor, encodeCursor, normalizePageLimit } from "../../sessions/facade";
import type { SessionSummary } from "@tiller/shared";

type SessionSummaryPageOptions = {
  limit?: number;
  before?: string;
};

export function pageSessionSummaries(sessions: SessionSummary[], options: SessionSummaryPageOptions = {}) {
  const sorted = sortSessionSummaries(sessions);
  const limit = normalizePageLimit(options.limit, 25, 200);
  const before = decodeSessionCursor(options.before);
  const eligible = before
    ? sorted.filter((session) => compareSessionPosition(session, before) > 0)
    : sorted;
  const page = eligible.slice(0, limit);
  const hasMore = eligible.length > page.length;
  return {
    sessions: page,
    nextCursor: hasMore ? encodeSessionCursor(page.at(-1)) : undefined,
    hasMore,
  };
}

function sortSessionSummaries(sessions: SessionSummary[]) {
  return [...sessions].sort((left, right) => compareSessionPosition(left, right));
}

function compareSessionPosition(
  left: Pick<SessionSummary, "id" | "createdAt" | "updatedAt">,
  right: Pick<SessionSummary, "id" | "createdAt" | "updatedAt">,
) {
  const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  const createdDelta = right.createdAt.localeCompare(left.createdAt);
  return createdDelta === 0 ? left.id.localeCompare(right.id) : createdDelta;
}

function encodeSessionCursor(session: SessionSummary | undefined) {
  return session ? encodeCursor(session.updatedAt, session.createdAt, session.id) : undefined;
}

function decodeSessionCursor(cursor: string | undefined) {
  const parts = decodeCursor(cursor, 3);
  return parts ? { updatedAt: parts[0], createdAt: parts[1], id: parts[2] } : null;
}
