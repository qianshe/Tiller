import type {
  AgentPlan,
  SessionPromptQueueSnapshot,
} from "./types";
import type { SessionLiveCompactionState } from "./session-transcript";

export type SessionLiveStateSnapshot = {
  plan?: AgentPlan;
  promptQueue?: SessionPromptQueueSnapshot;
  compactionState?: SessionLiveCompactionState;
};
