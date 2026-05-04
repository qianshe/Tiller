import type { FormEvent } from "react";
import type {
  AgentPromptContent,
  AgentPromptImageContent,
} from "@tiller/shared";
import { nextRequestId } from "./request-dispatch";

export function buildPromptContent(
  text: string,
  images: AgentPromptImageContent[],
): AgentPromptContent[] | undefined {
  if (!images.length) {
    return undefined;
  }
  return [...(text ? [{ type: "text" as const, text }] : []), ...images];
}

export function createSession(
  initialPrompt: string | undefined,
  initialContent: AgentPromptContent[] | undefined,
  context: any,
) {
  const {
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
  } = context;

  const projectId = selectedProjectId || projects[0]?.id;
  const workspaceId = selectedWorkspace?.id || filteredWorkspaces[0]?.id;
  const agentId = selectedAgentId || filteredAgents[0]?.id;
  if (!projectId || !workspaceId || !agentId || !socketRef.current) {
    return false;
  }

  pendingPromptRef.current = initialPrompt ?? null;
  pendingPromptContentRef.current = initialContent;
  dispatch(socketRef.current, {
    type: "session.create",
    requestId: nextRequestId(requestCounter),
    projectId,
    workspaceId,
    agentId,
    agentMode: effectiveDraftAgentMode,
    model: normalizeModelSelection(selectedModel),
    reasoningEffort: selectedReasoningEffort,
  });
  navigateToView("sessions");
  return true;
}

export function requestSessionResumeStart(
  sessionId: string,
  reason: string,
  context: any,
) {
  const {
    socketRef,
    resumeStartRequestsRef,
    setResumeFeedback,
    dispatch,
    requestCounter,
  } = context;

  if (
    !socketRef.current ||
    socketRef.current.readyState !== WebSocket.OPEN ||
    resumeStartRequestsRef.current.has(sessionId)
  ) {
    return;
  }

  resumeStartRequestsRef.current.add(sessionId);
  setResumeFeedback(reason);
  dispatch(socketRef.current, {
    type: "session.resume.start",
    requestId: nextRequestId(requestCounter),
    sessionId,
  });
}

export function submitPrompt(event: FormEvent<HTMLFormElement>, context: any) {
  const {
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
  } = context;

  event.preventDefault();
  const nextPrompt = prompt.trim();
  if ((!nextPrompt && !promptImages.length) || !socketRef.current) {
    return;
  }
  const messageText = nextPrompt || `图片 ${promptImages.length} 张`;
  const content = buildPromptContent(nextPrompt, promptImages);
  const imagesToSend = promptImages;
  setImagePasteNotice("");

  if (!activeSessionId) {
    if (createSession(messageText, content)) {
      setPrompt("");
      setPromptImages([]);
    }
    return;
  }

  const clientMessageId = createClientUserMessageId(activeSessionId);
  appendUserMessage(activeSessionId, messageText, clientMessageId, imagesToSend);
  setPrompt("");
  setPromptImages([]);
  dispatch(socketRef.current, {
    type: "session.prompt",
    requestId: nextRequestId(requestCounter),
    sessionId: activeSessionId,
    text: messageText,
    content,
    clientMessageId,
  });
}

export function startResume(context: any) {
  const { activeSessionId, socketRef, setResumeFeedback, dispatch, requestCounter } =
    context;
  if (!activeSessionId || !socketRef.current) {
    return;
  }

  setResumeFeedback("正在按能力检查 Tiller 客户端重连 / ACP 会话恢复...");
  dispatch(socketRef.current, {
    type: "session.resume.start",
    requestId: nextRequestId(requestCounter),
    sessionId: activeSessionId,
  });
}
