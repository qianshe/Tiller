import type { FormEvent, MutableRefObject } from "react";
import type {
  AcpAgentProvider,
  AgentPromptContent,
  AgentPromptImageContent,
  ProjectSummary,
  SessionReasoningEffort,
  WorkspaceSummary,
} from "@tiller/shared";
import { agentModelOptionsKey, type AgentModelOptionsEntry } from "../../agents/facade";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import { resolveNewSessionIdentity } from "../utils/session-identity";

type RpcClientRef = MutableRefObject<DeckRpcClient | null>;

type CreateSessionContext = {
  selectedProjectId?: string | null;
  projects: ProjectSummary[];
  selectedWorkspace?: WorkspaceSummary | null;
  filteredWorkspaces: WorkspaceSummary[];
  selectedAgentId?: string | null;
  filteredAgents: AcpAgentProvider[];
  agentModelOptions?: Record<string, AgentModelOptionsEntry>;
  rpcClientRef: RpcClientRef;
  pendingPromptRef: MutableRefObject<string | null>;
  pendingPromptContentRef: MutableRefObject<AgentPromptContent[] | undefined>;
  dispatch: DispatchToHelm;
  effectiveDraftAgentMode?: string;
  normalizeModelSelection: (model: string) => string | undefined;
  selectedModel: string;
  selectedReasoningEffort?: SessionReasoningEffort;
  navigateToView: (view: "sessions") => void;
};

type ResumeStartContext = {
  rpcClientRef: RpcClientRef;
  resumeStartRequestsRef: MutableRefObject<Set<string>>;
  setResumeFeedback: (value: string) => void;
  dispatch: DispatchToHelm;
};

type StartResumeContext = Omit<ResumeStartContext, "resumeStartRequestsRef"> & {
  activeSessionId: string | null;
};

type SubmitPromptContext = {
  prompt: string;
  promptImages: AgentPromptImageContent[];
  rpcClientRef: RpcClientRef;
  setImagePasteNotice: (value: string) => void;
  activeSessionId: string | null;
  activeSessionCanChat?: boolean;
  createSession: (
    initialPrompt?: string,
    initialContent?: AgentPromptContent[],
  ) => boolean;
  setPrompt: (value: string) => void;
  setPromptImages: (images: AgentPromptImageContent[]) => void;
  createClientUserMessageId: (sessionId: string) => string;
  appendUserMessage: (
    sessionId: string,
    text: string,
    id: string,
    attachments: AgentPromptImageContent[],
  ) => void;
  dispatch: DispatchToHelm;
};

function isClientOpen(client: DeckRpcClient | null): client is DeckRpcClient {
  return Boolean(client && client.socket.readyState === WebSocket.OPEN);
}

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
  context: CreateSessionContext,
) {
  const {
    selectedProjectId,
    projects,
    selectedWorkspace,
    filteredWorkspaces,
    selectedAgentId,
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
  } = context;

  const identity = resolveNewSessionIdentity({
    selectedProjectId,
    projects,
    selectedWorkspace,
    workspaces: filteredWorkspaces,
    selectedAgentId,
    agents: filteredAgents,
  });
  const client = rpcClientRef.current;
  if (!identity || !isClientOpen(client)) {
    return false;
  }

  const cacheKey = agentModelOptionsKey(
    identity.agentId,
    identity.cwd,
    identity.projectId,
  );
  const draft = agentModelOptions?.[cacheKey];
  if (initialPrompt && draft?.draftId) {
    pendingPromptRef.current = null;
    pendingPromptContentRef.current = undefined;
    void dispatch(client, "session/prompt", {
      draftId: draft.draftId,
      text: initialPrompt,
      content: initialContent,
    });
    navigateToView("sessions");
    return true;
  }

  pendingPromptRef.current = initialPrompt ?? null;
  pendingPromptContentRef.current = initialContent;
  void dispatch(client, "session/new", {
    projectId: identity.projectId,
    cwd: identity.cwd,
    agentId: identity.agentId,
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
  context: ResumeStartContext,
) {
  const {
    rpcClientRef,
    resumeStartRequestsRef,
    setResumeFeedback,
    dispatch,
  } = context;
  const client = rpcClientRef.current;

  if (!isClientOpen(client) || resumeStartRequestsRef.current.has(sessionId)) {
    return;
  }

  resumeStartRequestsRef.current.add(sessionId);
  setResumeFeedback(reason);
  void dispatch(client, "session/resume", { sessionId }).catch((error: unknown) => {
    resumeStartRequestsRef.current.delete(sessionId);
    setResumeFeedback(error instanceof Error ? error.message : "ACP 会话恢复请求失败，请重试。");
  });
}

export function submitPrompt(event: FormEvent<HTMLFormElement>, context: SubmitPromptContext) {
  const {
    prompt,
    promptImages,
    rpcClientRef,
    setImagePasteNotice,
    activeSessionId,
    activeSessionCanChat = true,
    createSession,
    setPrompt,
    setPromptImages,
    createClientUserMessageId,
    appendUserMessage,
    dispatch,
  } = context;

  event.preventDefault();
  const nextPrompt = prompt.trim();
  const client = rpcClientRef.current;
  if ((!nextPrompt && !promptImages.length) || !isClientOpen(client)) {
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

  if (!activeSessionCanChat) {
    return;
  }

  const clientMessageId = createClientUserMessageId(activeSessionId);
  appendUserMessage(activeSessionId, messageText, clientMessageId, imagesToSend);
  setPrompt("");
  setPromptImages([]);
  void dispatch(client, "session/prompt", {
    sessionId: activeSessionId,
    text: messageText,
    content,
    clientMessageId,
  });
}

export function startResume(context: StartResumeContext) {
  const { activeSessionId, rpcClientRef, setResumeFeedback, dispatch } = context;
  const client = rpcClientRef.current;
  if (!activeSessionId || !isClientOpen(client)) {
    return;
  }

  setResumeFeedback("正在按能力检查 Tiller 客户端重连 / ACP 会话恢复...");
  void dispatch(client, "session/resume", { sessionId: activeSessionId });
}
