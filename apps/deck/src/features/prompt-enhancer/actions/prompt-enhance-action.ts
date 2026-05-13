import type {
  AgentMessage,
  ProjectSummary,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { summarizeSessionContext } from "../../mission/facade";
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
  filteredWorkspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  activeSession: SessionSummary | null;
  draftProject: ProjectSummary | null;
  activeSessionMessages: AgentMessage[];
};

export function usePromptEnhanceAction({
  prompt,
  setPrompt,
  promptEnhancer,
  setPromptEnhancerBusy,
  setPromptEnhancerStatus,
  filteredWorkspaces,
  selectedWorkspaceId,
  activeSession,
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
      const workspace = filteredWorkspaces.find(
        (item) =>
          item.id === (activeSession?.workspaceId ?? selectedWorkspaceId) ||
          normalizeWorkspacePath(item.path) === normalizeWorkspacePath(activeSession?.workspacePath),
      );
      const enhanced = await enhancePromptWithLlm(rawPrompt, promptEnhancer, {
        projectName: draftProject?.name ?? activeSession?.projectName,
        workspaceName: workspace?.name ?? activeSession?.workspaceName,
        projectSummary: draftProject?.summary,
        workspaceSummary: workspace?.summary,
        sessionStatus: activeSession?.status,
        sessionSummary: summarizeSessionContext(
          activeSession,
          activeSession ? activeSessionMessages : [],
        ),
      });

      setPrompt(enhanced);
      setPromptEnhancerStatus("已增强并回填输入框，请确认后再发送。");
    } catch (error) {
      setPromptEnhancerStatus(
        error instanceof Error ? error.message : "提示词增强失败",
      );
    } finally {
      setPromptEnhancerBusy(false);
    }
  };
}

function normalizeWorkspacePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
