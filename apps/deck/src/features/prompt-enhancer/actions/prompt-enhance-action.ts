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
  messages: Record<string, AgentMessage[]>;
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
  messages,
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
          item.id === (activeSession?.workspaceId ?? selectedWorkspaceId),
      );
      const enhanced = await enhancePromptWithLlm(rawPrompt, promptEnhancer, {
        projectName: draftProject?.name ?? activeSession?.projectName,
        workspaceName: activeSession?.workspaceName ?? workspace?.name,
        projectSummary: draftProject?.summary,
        workspaceSummary: workspace?.summary,
        sessionStatus: activeSession?.status,
        sessionSummary: summarizeSessionContext(
          activeSession,
          activeSession ? (messages[activeSession.id] ?? []) : [],
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
