import type { AgentToolCall, CommandChunk, FileDiffSummary } from "@tiller/shared";
import {
  compareTimestampIdPosition,
  decodeCursor,
  encodeCursor,
  normalizePageLimit,
} from "./pagination";

type SessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export type SessionArtifactPageOptions = {
  limit?: number;
  before?: string;
};

export type SessionArtifactPage = SessionArtifacts & {
  nextCursor?: string;
  hasMore: boolean;
};

const DEFAULT_ARTIFACT_PAGE_LIMIT = 50;
const MAX_ARTIFACT_PAGE_LIMIT = 200;

export function pageSessionArtifacts(
  artifacts: SessionArtifacts,
  options: SessionArtifactPageOptions = {},
): SessionArtifactPage {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_ARTIFACT_PAGE_LIMIT,
    MAX_ARTIFACT_PAGE_LIMIT,
  );
  const before = decodeArtifactCursor(options.before);
  const activities = [
    ...artifacts.outputs.map((item) => ({
      kind: "output" as const,
      timestamp: item.timestamp,
      id: item.id,
      item,
    })),
    ...artifacts.toolCalls.map((item) => ({
      kind: "toolCall" as const,
      timestamp: item.updatedAt || item.timestamp,
      id: item.id,
      item,
    })),
  ].sort((left, right) =>
    compareTimestampIdPosition(left.timestamp, left.id, right.timestamp, right.id),
  );
  const eligible = before
    ? activities.filter(
        (activity) =>
          compareTimestampIdPosition(activity.timestamp, activity.id, before.timestamp, before.id) <
          0,
      )
    : activities;
  const pageActivities = eligible.slice(Math.max(eligible.length - limit, 0));
  const outputIds = new Set(
    pageActivities.filter((activity) => activity.kind === "output").map((activity) => activity.id),
  );
  const toolCallIds = new Set(
    pageActivities
      .filter((activity) => activity.kind === "toolCall")
      .map((activity) => activity.id),
  );
  const hasMore = eligible.length > pageActivities.length;

  return {
    outputs: artifacts.outputs.filter((item) => outputIds.has(item.id)),
    diffs: artifacts.diffs,
    toolCalls: artifacts.toolCalls.filter((item) => toolCallIds.has(item.id)),
    nextCursor: hasMore
      ? encodeCursor(pageActivities[0]?.timestamp, pageActivities[0]?.id)
      : undefined,
    hasMore,
  };
}

function decodeArtifactCursor(cursor: string | undefined) {
  const parts = decodeCursor(cursor, 2);
  return parts ? { timestamp: parts[0], id: parts[1] } : null;
}
