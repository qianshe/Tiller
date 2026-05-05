import type { ClientToHelm } from "@tiller/sync-protocol";
import type {
  AcpAgentProvider,
  AgentPromptContent,
  AgentPromptImageContent,
  PermissionDecision,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { nextRequestId } from "../../helm-connection/request-dispatch";
import { toast } from "../../toast";
import {
  createSession as createSessionImpl,
  requestSessionResumeStart as requestSessionResumeStartImpl,
  startResume as startResumeImpl,
  submitPrompt as submitPromptImpl,
} from "./session-actions";

type MutableRef<T> = { current: T };
type DispatchToHelm = (socket: WebSocket, payload: ClientToHelm) => void;

type UseSessionCommandActionsOptions = {
  prompt: string;
  promptImages: AgentPromptImageContent[];
  socketRef: MutableRef<WebSocket | null>;
  setImagePasteNotice: (value: string) => void;
  activeSessionId: string | null;
  selectedProjectId?: string | null;
  projects: ProjectSummary[];
  selectedWorkspace?: WorkspaceSummary | null;
  filteredWorkspaces: WorkspaceSummary[];
  selectedAgentId?: string | null;
  filteredAgents: AcpAgentProvider[];
  pendingPromptRef: MutableRef<string | null>;
  pendingPromptContentRef: MutableRef<AgentPromptContent[] | undefined>;
  dispatch: DispatchToHelm;
  requestCounter: MutableRef<number>;
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

export function useSessionCommandActions({
  prompt,
  promptImages,
  socketRef,
  setImagePasteNotice,
  activeSessionId,
  selectedProjectId,
  projects,
  selectedWorkspace,
  filteredWorkspaces,
  selectedAgentId,
  filteredAgents,
  pendingPromptRef,
  pendingPromptContentRef,
  dispatch,
  requestCounter,
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
  ) {
    return createSessionImpl(initialPrompt, initialContent, {
      selectedProjectId,
      projects,
      selectedWorkspace,
      filteredWorkspaces,
      selectedAgentId,
      filteredAgents,
      socketRef,
      pendingPromptRef,
      pendingPromptContentRef,
      dispatch,
      requestCounter,
      effectiveDraftAgentMode,
      normalizeModelSelection,
      selectedModel,
      selectedReasoningEffort,
      navigateToView,
    });
  }

  function requestSessionResumeStart(sessionId: string, reason: string) {
    requestSessionResumeStartImpl(sessionId, reason, {
      socketRef,
      resumeStartRequestsRef,
      setResumeFeedback,
      dispatch,
      requestCounter,
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

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    submitPromptImpl(event, {
      prompt,
      promptImages,
      socketRef,
      setImagePasteNotice,
      activeSessionId,
      createSession,
      setPrompt,
      setPromptImages,
      createClientUserMessageId,
      appendUserMessage,
      dispatch,
      requestCounter,
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

  function respondToPermission(decision: PermissionDecision) {
    if (!activeSessionId || !socketRef.current) {
      return;
    }
    const permissionRequest = permissionRequests[activeSessionId];
    if (!permissionRequest) {
      return;
    }
    dispatch(socketRef.current, {
      type: "permission.respond",
      requestId: nextRequestId(requestCounter),
      permissionRequestId: permissionRequest.id,
      decision,
    });
  }

  function startResume() {
    startResumeImpl({
      activeSessionId,
      socketRef,
      setResumeFeedback,
      dispatch,
      requestCounter,
    });
  }

  function cleanupSession(sessionId: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.warning("Helm 未连接，无法清理任务。");
      return;
    }
    toast.info("正在清理任务...", { id: "session-cleanup", duration: 2000 });
    dispatch(socket, {
      type: "session.cleanup",
      requestId: nextRequestId(requestCounter),
      sessionId,
    });
  }

  function cancelSession(sessionId: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.warning("Helm 未连接，无法取消任务。");
      return;
    }
    dispatch(socket, {
      type: "session.cancel",
      requestId: nextRequestId(requestCounter),
      sessionId,
    });
  }

  return {
    cancelSession,
    cleanupSession,
    createSession,
    requestSessionResumeStart,
    respondToPermission,
    shouldAutoStartSessionResume,
    startResume,
    submitPrompt,
    submitPromptFromKeyboard,
  };
}
