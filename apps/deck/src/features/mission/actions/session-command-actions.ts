import type {
  AcpAgentProvider,
  AgentPromptContent,
  AgentPromptImageContent,
  PermissionDecision,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { AgentModelOptionsEntry } from "../../agents/facade";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import { useDeckStore } from "../../../store";
import { toast } from "../../toast";
import {
  deleteQueuedPrompt as deleteQueuedPromptImpl,
  updateQueuedPrompt as updateQueuedPromptImpl,
} from "./queued-prompt-actions";
import {
  createSession as createSessionImpl,
  requestSessionResumeStart as requestSessionResumeStartImpl,
  startResume as startResumeImpl,
  submitPrompt as submitPromptImpl,
} from "./session-actions";
import { resolveSessionRestoreGate } from "../utils/session-state";

type MutableRef<T> = { current: T };

type UseSessionCommandActionsOptions = {
  prompt: string;
  promptImages: AgentPromptImageContent[];
  socketRef: MutableRef<WebSocket | null>;
  rpcClientRef: MutableRef<DeckRpcClient | null>;
  setImagePasteNotice: (value: string) => void;
  activeSessionId: string | null;
  activeSession?: SessionSummary | null;
  statuses: Record<string, SessionSummary["status"]>;
  selectedProjectId?: string | null;
  projects: ProjectSummary[];
  selectedWorktree?: WorktreeSummary | null;
  filteredWorktrees: WorktreeSummary[];
  selectedAgentId?: string | null;
  filteredAgents: AcpAgentProvider[];
  agentModelOptions?: Record<string, AgentModelOptionsEntry>;
  pendingPromptRef: MutableRef<string | null>;
  pendingPromptContentRef: MutableRef<AgentPromptContent[] | undefined>;
  dispatch: DispatchToHelm;
  effectiveDraftAgentMode?: string;
  normalizeModelSelection: (model: string) => string | undefined;
  selectedModel: string;
  selectedReasoningEffort?: SessionReasoningEffort;
  navigateToView: (view: "sessions") => void;
  setPrompt: (value: string) => void;
  setPromptImages: (images: AgentPromptImageContent[]) => void;
  createClientUserMessageId: (sessionId: string) => string;
  appendUserMessage: (
    sessionId: string,
    text: string,
    id: string,
    attachments: AgentPromptImageContent[],
  ) => void;
  permissionRequests: Record<string, PermissionRequest | null>;
  resumeStartRequestsRef: MutableRef<Set<string>>;
  setResumeFeedback: (value: string) => void;
};

function isClientOpen(client: DeckRpcClient | null): client is DeckRpcClient {
  return Boolean(client && client.socket.readyState === WebSocket.OPEN);
}

function mergeWorktreeOptions(
  left: WorktreeSummary[],
  right: WorktreeSummary[],
): WorktreeSummary[] {
  const byId = new Map(left.map((worktree) => [worktree.path, worktree]));
  right.forEach((worktree) => byId.set(worktree.path, worktree));
  return Array.from(byId.values());
}

export function useSessionCommandActions({
  prompt,
  promptImages,
  socketRef,
  rpcClientRef,
  setImagePasteNotice,
  activeSessionId,
  activeSession,
  statuses,
  selectedProjectId,
  projects,
  selectedWorktree,
  filteredWorktrees,
  selectedAgentId,
  filteredAgents,
  agentModelOptions,
  pendingPromptRef,
  pendingPromptContentRef,
  dispatch,
  effectiveDraftAgentMode,
  normalizeModelSelection,
  selectedModel,
  selectedReasoningEffort,
  navigateToView,
  setPrompt,
  setPromptImages,
  createClientUserMessageId,
  appendUserMessage,
  permissionRequests,
  resumeStartRequestsRef,
  setResumeFeedback,
}: UseSessionCommandActionsOptions) {
  function createSession(
    initialPrompt?: string,
    initialContent?: AgentPromptContent[],
    agentIdOverride?: string,
    worktreeOverride?: WorktreeSummary,
  ) {
    return createSessionImpl(initialPrompt, initialContent, {
      selectedProjectId,
      projects,
      selectedWorktree: worktreeOverride ?? selectedWorktree,
      filteredWorktrees: worktreeOverride
        ? mergeWorktreeOptions(filteredWorktrees, [worktreeOverride])
        : filteredWorktrees,
      selectedAgentId: agentIdOverride ?? selectedAgentId,
      filteredAgents,
      agentModelOptions,
      rpcClientRef,
      pendingPromptRef,
      pendingPromptContentRef,
      dispatch,
      effectiveDraftAgentMode,
      normalizeModelSelection,
      selectedModel,
      selectedReasoningEffort,
      navigateToView,
    });
  }

  function createDraftSessionForAgent(agentId: string, worktreeOverride?: WorktreeSummary) {
    return createSession(undefined, undefined, agentId, worktreeOverride);
  }

  function requestSessionResumeStart(sessionId: string, reason: string) {
    requestSessionResumeStartImpl(sessionId, reason, {
      rpcClientRef,
      resumeStartRequestsRef,
      setResumeFeedback,
      dispatch,
    });
  }

  function shouldAutoStartSessionResume(
    session: Pick<SessionSummary, "resume"> | undefined,
  ) {
    const resume = session?.resume;
    return Boolean(
      resume?.state === "resume-available" &&
        resume.mode === "reconnect" &&
        (resume.restoreMethod === "session/load" ||
          resume.restoreMethod === "session/resume"),
    );
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>, targetSession?: SessionSummary | null) {
    const promptSession = targetSession ?? activeSession;
    const promptSessionId = promptSession?.id ?? activeSessionId;
    const promptSessionStatus = promptSession
      ? (statuses[promptSession.id] ?? promptSession.status)
      : "idle";
    const promptSessionRestoreGate = resolveSessionRestoreGate({
      activeSession: promptSession,
      activeSessionStatus: promptSessionStatus,
      resumeStartPending: Boolean(
        promptSession && resumeStartRequestsRef.current.has(promptSession.id),
      ),
    });
    submitPromptImpl(event, {
      prompt,
      promptImages,
      rpcClientRef,
      setImagePasteNotice,
      activeSessionId: promptSessionId,
      activeSessionCanChat: promptSessionRestoreGate.canChat,
      createSession,
      setPrompt,
      setPromptImages,
      createClientUserMessageId,
      dispatch,
    });
  }

  function submitPromptFromKeyboard(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function respondToPermission(approvalRequestId: string, decision: PermissionDecision) {
    const client = rpcClientRef.current;
    if (!activeSessionId || !isClientOpen(client)) {
      return;
    }
    const store = useDeckStore.getState();
    const approval = store.approvalItemsById[approvalRequestId];
    if (!approval || approval.resolving) {
      return;
    }
    store.markApprovalResolving(approvalRequestId, true);
    void dispatch(client, "approval/respond", {
      approvalRequestId,
      decision,
    }).catch((error) => {
      useDeckStore.getState().markApprovalResolving(approvalRequestId, false);
      throw error;
    });
  }

  function startResume() {
    startResumeImpl({
      activeSessionId,
      rpcClientRef,
      setResumeFeedback,
      dispatch,
    });
  }

  function cleanupSession(sessionId: string) {
    const client = rpcClientRef.current;
    if (!isClientOpen(client)) {
      toast.warning("Helm 未连接，无法清理任务。");
      return;
    }
    toast.info("正在清理任务...", { id: "session-cleanup", duration: 2000 });
    void dispatch(client, "session/cleanup", { sessionId });
  }

  function reimportSessionHistory(sessionId: string) {
    const client = rpcClientRef.current;
    if (!isClientOpen(client)) {
      toast.warning("Helm 未连接，无法重新导入历史。");
      return;
    }
    toast.info("正在从 ACP 重新导入历史...", {
      id: `session-reimport-${sessionId}`,
      duration: 2000,
    });
    void dispatch(client, "session/reimport_history", { sessionId }).catch((error) => {
      toast.error(error instanceof Error ? error.message : "重新导入历史失败。");
    });
  }

  function cancelSession(sessionId: string) {
    const client = rpcClientRef.current;
    if (!isClientOpen(client)) {
      toast.warning("Helm 未连接，无法取消任务。");
      return;
    }
    void dispatch(client, "session/cancel", { sessionId });
  }

  function updateQueuedPrompt(sessionId: string, queueItemId: string, text: string) {
    updateQueuedPromptImpl(sessionId, queueItemId, text, { rpcClientRef, dispatch });
  }

  function deleteQueuedPrompt(sessionId: string, queueItemId: string) {
    deleteQueuedPromptImpl(sessionId, queueItemId, { rpcClientRef, dispatch });
  }

  return {
    cancelSession,
    cleanupSession,
    createDraftSessionForAgent,
    createSession,
    requestSessionResumeStart,
    reimportSessionHistory,
    respondToPermission,
    shouldAutoStartSessionResume,
    startResume,
    submitPrompt,
    submitPromptFromKeyboard,
    updateQueuedPrompt,
    deleteQueuedPrompt,
  };
}
