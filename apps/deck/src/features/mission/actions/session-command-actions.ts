import type {
  AcpAgentProvider,
  AgentPromptContent,
  AgentPromptImageContent,
  MissionPromptContextItem,
  PermissionDecision,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionSummary,
  SessionTimelineEntry,
  WorktreeSummary,
} from "@tiller/shared";
import type {
  Dispatch,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  SetStateAction,
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
import {
  isSessionConversationLoaded,
  resolveSessionRestoreGate,
} from "../utils/session-state";

type MutableRef<T> = { current: T };

type UseSessionCommandActionsOptions = {
  prompt: string;
  promptImages: AgentPromptImageContent[];
  draftContexts: MissionPromptContextItem[];
  socketRef: MutableRef<WebSocket | null>;
  rpcClientRef: MutableRef<DeckRpcClient | null>;
  setImagePasteNotice: (value: string) => void;
  activeSessionId: string | null;
  activeSession?: SessionSummary | null;
  statuses: Record<string, SessionSummary["status"]>;
  messageHistoryState?: Record<string, { loading: boolean } | undefined>;
  sessionTimeline?: Record<string, SessionTimelineEntry[] | undefined>;
  selectedProjectId?: string | null;
  projects: ProjectSummary[];
  selectedWorktree?: WorktreeSummary | null;
  filteredWorktrees: WorktreeSummary[];
  selectedAgentId?: string | null;
  filteredAgents: AcpAgentProvider[];
  agentModelOptions?: Record<string, AgentModelOptionsEntry>;
  pendingPromptRef: MutableRef<string | null>;
  pendingPromptContentRef: MutableRef<AgentPromptContent[] | undefined>;
  newSessionPromptPendingScopesRef: MutableRef<Set<string>>;
  dispatch: DispatchToHelm;
  effectiveDraftAgentMode?: string;
  normalizeModelSelection: (model: string) => string | undefined;
  selectedModel: string;
  selectedReasoningEffort?: SessionReasoningEffort;
  navigateToView: (view: "sessions") => void;
  isMobile?: boolean;
  setPrompt: Dispatch<SetStateAction<string>>;
  setPromptImages: Dispatch<SetStateAction<AgentPromptImageContent[]>>;
  clearDraftContexts: () => void;
  setCommandRetentionNotice?: (value: string | null) => void;
  createClientUserMessageId: (sessionId: string) => string;
  appendUserMessage: (
    sessionId: string,
    text: string,
    id: string,
    attachments: AgentPromptImageContent[],
  ) => void;
  permissionRequests: Record<string, PermissionRequest | null>;
  resumeStartRequestsRef: MutableRef<Set<string>>;
  setResumeStartRequestIds: Dispatch<SetStateAction<Set<string>>>;
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
  draftContexts,
  socketRef,
  rpcClientRef,
  setImagePasteNotice,
  activeSessionId,
  activeSession,
  statuses,
  messageHistoryState = {},
  sessionTimeline = {},
  selectedProjectId,
  projects,
  selectedWorktree,
  filteredWorktrees,
  selectedAgentId,
  filteredAgents,
  agentModelOptions,
  pendingPromptRef,
  pendingPromptContentRef,
  newSessionPromptPendingScopesRef,
  dispatch,
  effectiveDraftAgentMode,
  normalizeModelSelection,
  selectedModel,
  selectedReasoningEffort,
  navigateToView,
  isMobile = false,
  setPrompt,
  setPromptImages,
  clearDraftContexts,
  setCommandRetentionNotice,
  createClientUserMessageId,
  appendUserMessage,
  permissionRequests,
  resumeStartRequestsRef,
  setResumeStartRequestIds,
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
      newSessionPromptPendingScopesRef,
      restoreInitialPrompt: (promptToRestore, contentToRestore) => {
        const text = contentToRestore
          ? contentToRestore
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n")
          : promptToRestore;
        const images = contentToRestore?.filter(
          (item): item is AgentPromptImageContent => item.type === "image",
        ) ?? [];
        setPrompt((current) => current || text);
        setPromptImages((current) => current.length ? current : images);
      },
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
      setResumeStartRequestIds,
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
    const promptSession = targetSession === undefined ? activeSession : targetSession;
    const promptSessionId = targetSession === undefined
      ? promptSession?.id ?? activeSessionId
      : promptSession?.id ?? null;
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
    const promptSessionConversationLoaded = !promptSessionId ||
      isSessionConversationLoaded(
        promptSessionId,
        messageHistoryState,
        sessionTimeline,
      );
    submitPromptImpl(event, {
      prompt,
      promptImages,
      rpcClientRef,
      setImagePasteNotice,
      activeSessionId: promptSessionId,
      activeSessionCanChat:
        promptSessionRestoreGate.canChat && promptSessionConversationLoaded,
      createSession,
      setPrompt,
      setPromptImages,
      clearDraftContexts,
      setCommandRetentionNotice,
      draftContexts,
      createClientUserMessageId,
      appendUserMessage,
      dispatch,
    });
  }

  function submitPromptFromKeyboard(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (isMobile) {
      return;
    }
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
    if (!isClientOpen(client)) {
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
    respondToPermission,
    shouldAutoStartSessionResume,
    startResume,
    submitPrompt,
    submitPromptFromKeyboard,
    updateQueuedPrompt,
    deleteQueuedPrompt,
  };
}
