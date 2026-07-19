import type { SessionLiveStateSnapshot, SessionSummary } from "@tiller/shared";
import { createSessionStatusMap } from "../mission/utils/session-derivations";
import { mergeSessionSummaries } from "./helpers";
import { deriveAvailableCommandMapsFromSessions } from "./session-available-commands";
import {
  deriveConfigOptionMapsFromSessions,
  hasInitializedSessionConfig,
} from "./session-config-selection";

export type SessionListResultPayload = {
  sessions: SessionSummary[];
  before?: boolean;
  nextCursor?: string | null;
  hasMore?: boolean;
};

export function resolveLiveSessionTitle(
  summary: Pick<SessionSummary, "title">,
  snapshot: Pick<SessionLiveStateSnapshot, "sessionInfo">,
): string | undefined {
  const title = snapshot.sessionInfo?.title;
  return typeof title === "string" && !summary.title?.trim() ? title : undefined;
}

export function deriveSessionListResult({
  currentSessions,
  liveStatesBySession = {},
  payload,
}: {
  currentSessions: SessionSummary[];
  liveStatesBySession?: Record<string, SessionLiveStateSnapshot>;
  payload: SessionListResultPayload;
}) {
  const listedSessions = payload.before
    ? mergeSessionSummaries(currentSessions, payload.sessions)
    : payload.sessions;
  const nextSessions = listedSessions.map((session) =>
    mergeSessionLifecycleSummary(session, liveStatesBySession[session.id]));
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

export function mergeSessionLifecycleSummary(
  summary: SessionSummary,
  snapshot: SessionLiveStateSnapshot | undefined,
): SessionSummary {
  if (!snapshot) {
    return summary;
  }
  const initializedConfig = hasInitializedSessionConfig(snapshot.config)
    ? snapshot.config
    : undefined;
  const liveTitle = resolveLiveSessionTitle(summary, snapshot);
  return {
    ...summary,
    ...(snapshot.status ? { status: snapshot.status.effectiveStatus } : {}),
    ...(initializedConfig
      ? {
          agentMode: initializedConfig.agentMode ?? summary.agentMode,
          model: initializedConfig.model ?? summary.model,
          reasoningEffort: initializedConfig.reasoningEffort ?? summary.reasoningEffort,
          configOptions: initializedConfig.configOptions,
          modelOptions: initializedConfig.modelOptions,
        }
      : {}),
    ...(snapshot.availableCommands
      ? { availableCommands: snapshot.availableCommands }
      : {}),
    ...(liveTitle !== undefined
      ? { title: liveTitle }
      : {}),
    ...(typeof snapshot.sessionInfo?.updatedAt === "string"
      ? { updatedAt: snapshot.sessionInfo.updatedAt }
      : {}),
  };
}
