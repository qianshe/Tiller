import type { SessionSummary } from "@tiller/shared";
import { createSessionStatusMap } from "../mission/utils/session-derivations";
import { mergeSessionSummaries } from "./helpers";
import { deriveAvailableCommandMapsFromSessions } from "./session-available-commands";
import { deriveConfigOptionMapsFromSessions } from "./session-config-selection";

export type SessionListResultPayload = {
  sessions: SessionSummary[];
  before?: boolean;
  nextCursor?: string | null;
  hasMore?: boolean;
};

export function deriveSessionListResult({
  currentSessions,
  payload,
}: {
  currentSessions: SessionSummary[];
  payload: SessionListResultPayload;
}) {
  const nextSessions = payload.before
    ? mergeSessionSummaries(currentSessions, payload.sessions)
    : payload.sessions;
  const nextStatuses = createSessionStatusMap(nextSessions);
  return {
    nextSessions,
    nextStatuses,
    historyState: {
      nextCursor: payload.nextCursor ?? undefined,
      hasMore: Boolean(payload.hasMore),
      loading: false,
    },
    configOptionsBySession: deriveConfigOptionMapsFromSessions(nextSessions),
    availableCommands: deriveAvailableCommandMapsFromSessions(nextSessions),
  };
}
