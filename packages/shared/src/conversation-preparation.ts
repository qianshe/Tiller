import type { SessionReasoningEffort } from "./types";

export type ConversationPreparation = {
  id: string;
  content: string;
  title?: string;
  projectId?: string;
  cwd?: string;
  agentId?: string;
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
