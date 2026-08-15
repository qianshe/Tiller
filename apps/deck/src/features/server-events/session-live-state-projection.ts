import type { AgentPlan, SessionLiveStateSnapshot } from "@tiller/shared";
import type { DeckStore } from "../../store";
import { availableCommandListsEqual } from "./helpers";
import {
  applySessionConfigSelection,
  hasInitializedSessionConfig,
  resolveSessionConfigSelection,
} from "./session-config-selection";
import { resolveLiveSessionTitle } from "./session-list-result";

export type SessionLiveStateProjection = {
  applied: boolean;
  patch?: Partial<DeckStore>;
};

export function projectSessionLiveStateSnapshot(
  state: DeckStore,
  sessionId: string,
  snapshot: SessionLiveStateSnapshot | undefined,
): SessionLiveStateProjection {
  if (!snapshot) {
    return { applied: false };
  }

  if (typeof snapshot.sequence !== "number") {
    const patch: Partial<DeckStore> = {};
    if (isAgentPlanPayload(snapshot.plan)) {
      const plans = replaceRecordValue(state.sessionPlans, sessionId, snapshot.plan);
      if (plans !== state.sessionPlans) {
        patch.sessionPlans = plans;
      }
    }
    if (snapshot.promptQueue) {
      const queues = replaceRecordValue(state.promptQueues, sessionId, snapshot.promptQueue);
      if (queues !== state.promptQueues) {
        patch.promptQueues = queues;
      }
    }
    return Object.keys(patch).length > 0 ? { applied: true, patch } : { applied: false };
  }

  const currentSequence = state.sessionLiveStateSequences[sessionId];
  if (currentSequence !== undefined && snapshot.sequence <= currentSequence) {
    return { applied: false };
  }

  const patch: Partial<DeckStore> = {
    sessionLiveStates: replaceRecordValue(state.sessionLiveStates, sessionId, snapshot),
    sessionLiveStateSequences: replaceRecordValue(
      state.sessionLiveStateSequences,
      sessionId,
      snapshot.sequence,
    ),
  };
  const currentSession = state.sessions.find((session) => session.id === sessionId);
  const liveTitle = currentSession
    ? resolveLiveSessionTitle(currentSession, snapshot)
    : undefined;
  const initializedConfig = hasInitializedSessionConfig(snapshot.config)
    ? snapshot.config
    : undefined;
  const selection = initializedConfig
    ? resolveSessionConfigSelection(currentSession, snapshot.config)
    : undefined;
  const plan = isAgentPlanPayload(snapshot.plan) ? snapshot.plan : undefined;
  const plans = plan
    ? replaceRecordValue(state.sessionPlans, sessionId, plan)
    : removeRecordValue(state.sessionPlans, sessionId);
  if (plans !== state.sessionPlans) {
    patch.sessionPlans = plans;
  }
  const queues = snapshot.promptQueue
    ? replaceRecordValue(state.promptQueues, sessionId, snapshot.promptQueue)
    : removeRecordValue(state.promptQueues, sessionId);
  if (queues !== state.promptQueues) {
    patch.promptQueues = queues;
  }

  if (initializedConfig && selection) {
    const configOptions = replaceRecordValue(
      state.sessionConfigOptions,
      sessionId,
      applySessionConfigSelection(initializedConfig.configOptions, selection),
    );
    if (configOptions !== state.sessionConfigOptions) {
      patch.sessionConfigOptions = configOptions;
    }
  }
  if (snapshot.availableCommands) {
    if (!availableCommandListsEqual(
      state.sessionAvailableCommands[sessionId],
      snapshot.availableCommands,
    )) {
      patch.sessionAvailableCommands = replaceRecordValue(
        state.sessionAvailableCommands,
        sessionId,
        snapshot.availableCommands,
      );
    }
    if (
      currentSession?.agentId &&
      !availableCommandListsEqual(
        state.agentAvailableCommands[currentSession.agentId],
        snapshot.availableCommands,
      )
    ) {
      patch.agentAvailableCommands = replaceRecordValue(
        state.agentAvailableCommands,
        currentSession.agentId,
        snapshot.availableCommands,
      );
    }
  }
  if (snapshot.diffs) {
    patch.diffs = replaceRecordValue(state.diffs, sessionId, snapshot.diffs);
  }
  if (
    currentSession &&
    (initializedConfig || snapshot.availableCommands || snapshot.sessionInfo)
  ) {
    patch.sessions = state.sessions.map((session) =>
      session.id !== sessionId
        ? session
        : {
            ...session,
            ...(initializedConfig && selection
              ? {
                  agentMode: selection.agentMode,
                  model: selection.model,
                  reasoningEffort: selection.reasoningEffort,
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
          },
    );
  }
  return { applied: true, patch };
}

export function isAgentPlanPayload(value: unknown): value is AgentPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<AgentPlan>;
  return typeof record.updatedAt === "string" &&
    Array.isArray(record.entries) &&
    record.entries.every((entry) =>
      Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { content?: unknown }).content === "string" &&
        ((entry as { priority?: unknown }).priority === "high" ||
          (entry as { priority?: unknown }).priority === "medium" ||
          (entry as { priority?: unknown }).priority === "low") &&
        ((entry as { status?: unknown }).status === "pending" ||
          (entry as { status?: unknown }).status === "in_progress" ||
          (entry as { status?: unknown }).status === "completed"),
    );
}

function replaceRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): Record<string, T> {
  return record[key] === value ? record : { ...record, [key]: value };
}

function removeRecordValue<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
}
