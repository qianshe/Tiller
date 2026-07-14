import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  CanonicalSessionState,
  SessionPromptQueueSnapshot,
} from "@tiller/shared";

export type CanonicalSessionStateEvent =
  | Extract<
      SessionRuntimeEvent,
      {
        type:
          | "status"
          | "config-options"
          | "model-options"
          | "mode-update"
          | "plan-update"
          | "available-commands"
          | "usage-update"
          | "session-info"
          | "diff-update";
      }
    >
  | {
      type: "prompt-queue";
      snapshot: SessionPromptQueueSnapshot;
    }
  | {
      type: "pending-approval-count";
      count: number;
    };

export function createCanonicalSessionState(): CanonicalSessionState {
  return {
    sequence: 0,
    status: {
      runtimeStatus: "starting",
      effectiveStatus: "starting",
      pendingApprovalCount: 0,
    },
    config: {
      configOptions: [],
      modelOptions: [],
    },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  };
}

export function applyCanonicalSessionStateEvent(
  state: CanonicalSessionState,
  event: CanonicalSessionStateEvent,
  sequence: number,
): CanonicalSessionState {
  switch (event.type) {
    case "status":
      return withSequence({
        ...state,
        status: deriveStatus({
          ...state.status,
          runtimeStatus: event.status,
        }),
      }, sequence);
    case "pending-approval-count":
      return withSequence({
        ...state,
        status: deriveStatus({
          ...state.status,
          pendingApprovalCount: Math.max(0, event.count),
        }),
      }, sequence);
    case "config-options":
      return withSequence({
        ...state,
        config: {
          ...state.config,
          ...event.state,
          configOptions: event.options,
        },
      }, sequence);
    case "model-options":
      return withSequence({
        ...state,
        config: {
          ...state.config,
          model: event.state.currentModelId ?? state.config.model,
          modelOptions: event.state.options,
        },
      }, sequence);
    case "mode-update":
      return withSequence({
        ...state,
        config: {
          ...state.config,
          agentMode: event.agentMode,
        },
      }, sequence);
    case "plan-update":
      return withSequence({ ...state, plan: event.plan }, sequence);
    case "available-commands":
      return withSequence({
        ...state,
        availableCommands: event.commands,
      }, sequence);
    case "usage-update":
      return withSequence({ ...state, usage: event.usage }, sequence);
    case "session-info":
      return withSequence({
        ...state,
        sessionInfo: {
          ...state.sessionInfo,
          ...("title" in event ? { title: event.title } : {}),
          ...("updatedAt" in event ? { updatedAt: event.updatedAt } : {}),
        },
      }, sequence);
    case "diff-update":
      return withSequence({ ...state, diffs: event.files }, sequence);
    case "prompt-queue":
      return withSequence({ ...state, promptQueue: event.snapshot }, sequence);
  }
}

function deriveStatus(
  status: CanonicalSessionState["status"],
): CanonicalSessionState["status"] {
  return {
    ...status,
    effectiveStatus: status.pendingApprovalCount > 0
      ? "waiting_for_permission"
      : status.runtimeStatus,
  };
}

function withSequence(
  state: CanonicalSessionState,
  sequence: number,
): CanonicalSessionState {
  return {
    ...state,
    sequence,
  };
}
