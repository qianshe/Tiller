import type { ProjectFileSummary } from "@tiller/shared";
import type { AgentModelOptionsEntry } from "../features/agents/utils/agent-model-options-cache";

export type AgentDraft = { name: string; command: string; args: string };

export type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};

export type AgentModelOptionsCache = Record<
  string,
  AgentModelOptionsEntry & { cachedAt: number }
>;
