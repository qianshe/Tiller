import type {
  ProjectSummary,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import {
  generateAssistantHandoffPrompt,
  isPromptEnhancerLlmConfigured,
  type PromptEnhancerPreferences,
} from "../enhancer";

type GenerateAssistantHandoffDraftOptions = {
  assistantBlockText: string;
  session: SessionSummary;
  sessionSummary: string;
  promptEnhancer: PromptEnhancerPreferences;
  projects: ProjectSummary[];
  worktrees: WorktreeSummary[];
  selectedCwd: string | null;
  activeSessionProject?: ProjectSummary | null;
  draftProject: ProjectSummary | null;
  setPrompt: (value: string) => void;
  setPromptEnhancerStatus: (value: string) => void;
};

export function canGenerateAssistantHandoff(
  promptEnhancer: PromptEnhancerPreferences,
) {
  return isPromptEnhancerLlmConfigured(promptEnhancer.llm);
}

export async function generateAssistantHandoffDraft({
  assistantBlockText,
  session,
  sessionSummary,
  promptEnhancer,
  projects,
  worktrees,
  selectedCwd,
  activeSessionProject,
  draftProject,
  setPrompt,
  setPromptEnhancerStatus,
}: GenerateAssistantHandoffDraftOptions) {
  if (!canGenerateAssistantHandoff(promptEnhancer)) {
    return;
  }

  setPromptEnhancerStatus("正在生成 Handoff 草稿...");
  const project =
    projects.find((item) => item.id === session.projectId) ??
    activeSessionProject ??
    draftProject;
  const worktree = worktrees.find(
    (item) =>
      normalizeWorktreePath(item.path) ===
        normalizeWorktreePath(session.cwd ?? selectedCwd ?? undefined) ||
      normalizeWorktreePath(item.path) === normalizeWorktreePath(session.cwd),
  );

  const handoffPrompt = await generateAssistantHandoffPrompt(
    {
      assistantBlockText,
      projectName: project?.name ?? session.projectName,
      worktreeName: worktree?.name ?? session.worktreeName,
      projectSummary: project?.summary,
      worktreeSummary: worktree?.summary,
      sessionStatus: session.status,
      sessionSummary,
    },
    promptEnhancer,
  );

  setPrompt(handoffPrompt);
  setPromptEnhancerStatus("已生成 Handoff 草稿，请确认后再发送。");
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
