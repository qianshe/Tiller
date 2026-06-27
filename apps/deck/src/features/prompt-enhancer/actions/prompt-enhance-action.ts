import type {
  AgentMessage,
  ProjectSummary,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import { summarizeSessionContext } from "../../mission/facade";
import { toast } from "../../toast";
import {
  enhancePromptWithLlm,
  type PromptEnhancerPreferences,
} from "../enhancer";

type UsePromptEnhanceActionOptions = {
  prompt: string;
  setPrompt: (value: string) => void;
  promptEnhancer: PromptEnhancerPreferences;
  setPromptEnhancerBusy: (value: boolean) => void;
  setPromptEnhancerStatus: (value: string) => void;
  filteredWorktrees: WorktreeSummary[];
  selectedCwd: string | null;
  activeSession: SessionSummary | null;
  activeSessionProject?: ProjectSummary | null;
  draftProject: ProjectSummary | null;
  activeSessionMessages: AgentMessage[];
};

export function usePromptEnhanceAction({
  prompt,
  setPrompt,
  promptEnhancer,
  setPromptEnhancerBusy,
  setPromptEnhancerStatus,
  filteredWorktrees,
  selectedCwd,
  activeSession,
  activeSessionProject,
  draftProject,
  activeSessionMessages,
}: UsePromptEnhanceActionOptions) {
  return async function enhancePromptDraft() {
    const rawPrompt = prompt.trim();
    if (!rawPrompt) {
      return;
    }

    setPromptEnhancerBusy(true);
    setPromptEnhancerStatus("正在增强提示词...");
    try {
      const worktree = filteredWorktrees.find(
        (item) =>
          normalizeWorktreePath(item.path) === normalizeWorktreePath(activeSession?.cwd ?? selectedCwd ?? undefined) ||
          normalizeWorktreePath(item.path) === normalizeWorktreePath(activeSession?.cwd),
      );
      const project = activeSessionProject ?? draftProject;
      const enhanced = await enhancePromptWithLlm(rawPrompt, promptEnhancer, {
        projectName: project?.name ?? activeSession?.projectName,
        worktreeName: worktree?.name ?? activeSession?.worktreeName,
        projectSummary: project?.summary,
        worktreeSummary: worktree?.summary,
        sessionStatus: activeSession?.status,
        sessionSummary: summarizeSessionContext(
          activeSession,
          activeSession ? activeSessionMessages : [],
        ),
      });

      setPrompt(enhanced);
      setPromptEnhancerStatus("");
      // 使用 Toast 通知成功
      toast.success("提示词已增强，请确认后发送");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "提示词增强失败";
      setPromptEnhancerStatus("");
      // 使用 Toast 通知错误，错误类型的 toast 会显示更久
      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setPromptEnhancerBusy(false);
    }
  };
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
