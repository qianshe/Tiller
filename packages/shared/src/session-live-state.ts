import type {
  AgentPlan,
  SessionPromptQueueSnapshot,
} from "./types";

export type SessionLiveStateSnapshot = {
  plan?: AgentPlan;
  promptQueue?: SessionPromptQueueSnapshot;
};
