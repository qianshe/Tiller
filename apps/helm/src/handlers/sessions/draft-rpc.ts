import type { SessionReasoningEffort } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import { resolveProjectSessionWorktree } from "./session-worktree";

export type CreateSessionDraftParams = {
  deckClientId: string;
  projectId: string;
  cwd: string;
  agentId: string;
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export type DiscardSessionDraftParams = {
  deckClientId: string;
  draftId?: string;
  scopeKey?: string;
  reason: "scope-change" | "tab-disconnect" | "ttl" | "shutdown" | "user";
};

export async function createSessionDraft(
  params: CreateSessionDraftParams,
  context: HelmHandlerContext,
) {
  const helms = context.loadAvailableHelms();
  const worktrees = context.loadAvailableWorktrees();
  const agents = context.loadAvailableAgents();
  context.setHelms(helms);
  context.setWorktrees(worktrees);
  context.setAgents(agents);
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);

  const project = context.resolveProjectById(params.projectId, projects);
  const worktree = project
    ? resolveProjectSessionWorktree(project, worktrees, params)
    : undefined;
  const agent = context.resolveProviderById(params.agentId, agents);
  const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

  if (!project || !worktree || !agent || !helm) {
    throw new Error("Project, helm, worktree, or agent not found");
  }

  return context.createRuntimeDraft({
    deckClientId: params.deckClientId,
    project,
    helm,
    worktree,
    agent,
    sessionConfig: {
      agentMode: params.agentMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
    },
  });
}

export async function discardSessionDraft(
  params: DiscardSessionDraftParams,
  context: HelmHandlerContext,
) {
  return context.discardRuntimeDraft(params);
}
