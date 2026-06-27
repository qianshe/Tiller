import type { AgentProviderDescriptor, ProjectSummary, WorktreeSummary } from "@tiller/domain-contracts";

export type ProviderRegistryPort = {
  listProviders(): Promise<AgentProviderDescriptor[]>;
  findProvider(providerId: string): Promise<AgentProviderDescriptor | undefined>;
};

export type ProjectRegistryPort = {
  listProjects(): Promise<ProjectSummary[]>;
  listWorktrees(projectId?: string): Promise<WorktreeSummary[]>;
};
