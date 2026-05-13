import type {
  ProjectFileSummary,
  SessionConfigOptionValue,
  SessionReasoningEffort,
} from "@tiller/shared";

export type SessionConfigPreferencePatch = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
  configId?: string;
  value?: SessionConfigOptionValue;
};

export type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};
