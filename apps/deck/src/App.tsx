import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import type { ClientToDaemon, DaemonToClient } from "@tiller/sync-protocol";
import { resolveSessionConfigSupport } from "@tiller/shared";
import type {
  AcpAgentProvider,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionDecision,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { CommandOutput, DiffSummary, InfoList, PairingBoxes, StatCard } from "./ui";

const DEFAULT_DAEMON_HOST = "127.0.0.1";
const DEFAULT_DAEMON_PORT = "47631";
const AGENT_DRAFT_STORAGE_KEY = "tiller.agent-draft";
const DAEMON_HOST_KEY = "tiller.daemon-host";
const DAEMON_PORT_KEY = "tiller.daemon-port";
const DAEMON_PROFILE_STORAGE_KEY = "tiller.daemon-profiles";
const MODEL_OPTIONS = [
  "provider-default",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.2",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4",
] as const;
const REASONING_OPTIONS: Array<{ value: SessionReasoningEffort; label: string }> = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
];
const UI_COPY = {
  "zh-CN": {
    localeLabel: "中文",
    heroEyebrow: "ACP Coding Agent 舰队指挥甲板",
    heroBody: "一个 Command Deck，多个 Helm，任意 ACP Crew。当前默认走真实 ACP mission，并保留最小协议归一化层来接入不同实现。",
    connection: {
      connecting: "连接中",
      connected: "已连接",
      disconnected: "已断开",
    },
    daemonAddress: "Helm 地址",
    daemonPort: "端口",
    connectDaemon: "连接 Helm",
    reconnectDaemon: "重新连接",
    connectHint: "先填写你的 Helm 地址和端口，再主动连接。连接成功后才进入配对流程。",
    connectFeedbackIdle: "尚未连接 Helm。",
    connectFeedbackConnecting: "正在连接 Helm...",
    pairingTitle: "设备配对",
    pairingHint: "连接成功后，请输入 Helm 终端显示的 6 位配对码。",
    pairingFeedbackIdle: "等待输入配对码。",
    pairingDebug: "调试回显",
    controlPlane: "指挥甲板",
    testConfiguredAgent: "测试当前 Crew",
    createSession: "创建 Mission",
    selectedWorkspace: "工作区",
    selectedAgent: "Crew",
    workspaces: "工作区",
    agents: "ACP Crew",
    noWorkspaces: "暂无工作区",
    noAgents: "暂无 Crew",
    addAgentDraft: "添加 ACP Crew 配置",
    saveDraftLocal: "保存本地配置草稿",
    writeDaemonConfig: "写入 Helm 配置",
    name: "名称",
    command: "命令",
    arguments: "参数",
    draftOnlyTitle: "本地配置草稿",
    draftOnlyHint: "可先录入一个真实 ACP Crew command 组合，例如 `opencode acp --pure`，确认无误后再写入 Helm 配置。",
    daemonConfigTitle: "写入 Helm 配置",
    daemonConfigHint: "这里会向 `~/.tiller/config.json` 写入 Crew provider 条目。建议先测试当前 Crew 命令可用。",
    hooksTitle: "ACP 归一化层",
    hooksBody: "runtime 会把 session/update 尽量归一化为消息、权限请求、Logbook 与 diff 事件，便于不同 ACP Crew 共用同一套 UI。",
    agentTestTitle: "Crew 测试",
    sessions: "Mission",
    totalSuffix: "个",
    noSessions: "先创建一个 Mission 开始控制环路。",
    sessionDetail: "Mission 详情",
    noActiveSession: "还没有活跃 Mission。",
    cancelSession: "取消 Mission",
    cleanupSession: "清理 Mission",
    promptPlaceholder: "向当前 Mission 下达指令",
    sendPrompt: "发送提示词",
    agentStream: "Crew 消息流",
    commandOutput: "Logbook",
    diffSummary: "变更摘要",
    waitingForAgent: "等待 Crew 活动中。",
    permissionRequest: "权限请求",
    allowOnce: "本次允许",
    deny: "拒绝",
    noCommandOutput: "Logbook 暂无记录。",
    noDiffSummary: "还没有文件变更。",
    role: {
      assistant: "助手",
      system: "系统",
      user: "你",
    },
    status: {
      starting: "启动中",
      running: "运行中",
      waiting_for_permission: "等待审批",
      idle: "空闲",
      error: "错误",
      cancelled: "已取消",
    },
    draftLoaded: "已从浏览器本地存储加载配置草稿。",
    draftParseFailed: "本地配置草稿解析失败，已回退到默认 ACP 配置。",
    savedDraft: "已保存本地配置草稿：",
    writingConfig: "正在写入 Crew provider 到 Helm 配置...",
    testRunningPrefix: "正在测试",
  },
} as const;

type AgentDraft = {
  name: string;
  command: string;
  args: string;
};


type DaemonProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
};

type Locale = keyof typeof UI_COPY;

type DebugTrace = {
  connectClicks: number;
  pairClicks: number;
  requestsSent: number;
  lastRequestType: string;
};

type CleanupFeedback = {
  tone: "success" | "warning" | "info";
  message: string;
};

type AppView = "overview" | "sessions" | "agents" | "settings";

const VIEW_PATHS: Record<AppView, string> = {
  overview: "/",
  sessions: "/sessions",
  agents: "/agents",
  settings: "/settings",
};

function TopNav({
  activeView,
  onNavigate,
  connection,
}: {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  connection: "connecting" | "connected" | "disconnected";
}) {
  const items: { id: AppView; label: string }[] = [
    { id: "overview", label: "总览" },
    { id: "sessions", label: "Mission" },
    { id: "agents", label: "Crew" },
    { id: "settings", label: "设置" },
  ];
  const statusLabel = connection === "connected" ? "已连接" : connection === "connecting" ? "连接中" : "已断开";

  return (
    <header className="top-nav card">
      <div className="top-nav-brand">
        <span className="top-nav-logo">🚀</span>
        <strong>Tiller</strong>
      </div>
      <nav className="top-nav-links" aria-label="主导航">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`top-nav-item ${activeView === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={`status-pill status-${connection}`}>
        <span className="dot" />
        {statusLabel}
      </div>
    </header>
  );
}

export function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const requestCounter = useRef(0);
  const pairInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastPairingAttemptRef = useRef<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);

  const locale: Locale = "zh-CN";
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [pairingState, setPairingState] = useState<"idle" | "waiting" | "input" | "paired" | "rejected">("idle");
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  const [pairingFeedback, setPairingFeedback] = useState("");
  const [connectFeedback, setConnectFeedback] = useState("");
  const [daemonHost, setDaemonHost] = useState(DEFAULT_DAEMON_HOST);
  const [daemonPort, setDaemonPort] = useState(DEFAULT_DAEMON_PORT);
  const [debugTrace, setDebugTrace] = useState<DebugTrace>({
    connectClicks: 0,
    pairClicks: 0,
    requestsSent: 0,
    lastRequestType: "none",
  });
  const [helms, setHelms] = useState<HelmSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [agents, setAgents] = useState<AcpAgentProvider[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [messages, setMessages] = useState<Record<string, AgentMessage[]>>({});
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest | null>>({});
  const [outputs, setOutputs] = useState<Record<string, CommandChunk[]>>({});
  const [diffs, setDiffs] = useState<Record<string, FileDiffSummary[]>>({});
  const [prompt, setPrompt] = useState("请审查当前登录流程，并提出最小且安全的重构方案。");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(MODEL_OPTIONS[0]);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<SessionReasoningEffort>("medium");
  const [agentTestResult, setAgentTestResult] = useState<string>("尚未测试");
  const [resumeFeedback, setResumeFeedback] = useState<string>("");
  const [cleanupFeedback, setCleanupFeedback] = useState<CleanupFeedback | null>(null);
  const [activeView, setActiveView] = useState<AppView>(() => resolveViewFromPath(window.location.pathname));
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({
    name: "OpenCode",
    command: "opencode",
    args: "acp --pure",
  });
  const [draftSaveMessage, setDraftSaveMessage] = useState<string>("草稿未保存");
  const [configSaveMessage, setConfigSaveMessage] = useState<string>("尚未写入 Helm 配置");
  const [daemonProfiles, setDaemonProfiles] = useState<DaemonProfile[]>([]);
  const [daemonProfileName, setDaemonProfileName] = useState<string>("");
  const [daemonProfileMessage, setDaemonProfileMessage] = useState<string>("");

  const copy = UI_COPY[locale];

  const resolvedSessions = useMemo(
    () => sessions.map((session) => alignSessionProject(session, projects)),
    [projects, sessions],
  );
  const activeSession = useMemo(
    () => resolvedSessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, resolvedSessions],
  );
  const draftProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const activeHelm = useMemo(() => {
    const helmId = activeSession?.helmId ?? draftProject?.helmId;
    return helms.find((helm) => helm.id === helmId) ?? null;
  }, [activeSession?.helmId, draftProject?.helmId, helms]);
  const filteredWorkspaces = useMemo(() => {
    const workspaceIds = draftProject?.workspaceIds;
    if (!workspaceIds?.length) {
      return workspaces;
    }
    return workspaces.filter((workspace) => workspaceIds.includes(workspace.id));
  }, [draftProject?.workspaceIds, workspaces]);
  const filteredAgents = useMemo(() => {
    const allowedAgentIds = draftProject?.allowedAgentIds;
    if (!allowedAgentIds?.length) {
      return agents;
    }
    return agents.filter((agent) => allowedAgentIds.includes(agent.id));
  }, [agents, draftProject?.allowedAgentIds]);
  const projectSessions = useMemo(
    () => resolvedSessions.filter((session) => !selectedProjectId || session.projectId === selectedProjectId),
    [resolvedSessions, selectedProjectId],
  );
  const sessionCountsByProject = useMemo(
    () => resolvedSessions.reduce<Record<string, number>>((counts, session) => ({ ...counts, [session.projectId]: (counts[session.projectId] ?? 0) + 1 }), {}),
    [resolvedSessions],
  );
  const activeStatus = activeSession ? copy.status[statuses[activeSession.id] ?? activeSession.status] : copy.status.idle;
  const activeResumeLabel = formatResumeLabel(activeSession?.resume, locale);
  const pendingPermission = activeSession ? permissionRequests[activeSession.id] ?? null : null;
  const draftModel = activeSession ? activeSession.model ?? MODEL_OPTIONS[0] : selectedModel;
  const draftReasoningEffort = activeSession ? activeSession.reasoningEffort ?? "medium" : selectedReasoningEffort;
  const draftConfigHint = resolveSessionConfigHint(activeSession, agents, activeSession?.agentId ?? selectedAgentId);
  const draftModelPlaceholder = resolveModelInputPlaceholder(activeSession, agents, activeSession?.agentId ?? selectedAgentId);
  const daemonInventory = daemonProfiles.map((profile) =>
    formatDaemonProfileLine(profile, daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT, connection, locale),
  );
  const viewLabels: Record<AppView, string> = {
    overview: "总览",
    sessions: "Mission",
    agents: "Crew",
    settings: "设置",
  };

  function navigateToView(view: AppView) {
    const nextPath = VIEW_PATHS[view];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setActiveView(view);
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setActiveSessionId((current) => {
      if (current && resolvedSessions.some((session) => session.id === current && session.projectId === projectId)) {
        return current;
      }
      return resolvedSessions.find((session) => session.projectId === projectId)?.id ?? null;
    });
  }

  function openSession(sessionId: string) {
    const session = resolvedSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    setSelectedProjectId(session.projectId);
    setActiveSessionId(sessionId);
  }

  function updateSessionDraftPreferences(next: { model?: string; reasoningEffort?: SessionReasoningEffort }) {
    if (activeSession && socketRef.current) {
      dispatch(socketRef.current, {
        type: "session.configure",
        requestId: nextRequestId(requestCounter),
        sessionId: activeSession.id,
        model: normalizeModelSelection(next.model ?? activeSession.model ?? draftModel),
        reasoningEffort: next.reasoningEffort ?? activeSession.reasoningEffort ?? selectedReasoningEffort,
      });
      return;
    }

    if (typeof next.model === "string") {
      setSelectedModel(next.model);
    }
    if (next.reasoningEffort) {
      setSelectedReasoningEffort(next.reasoningEffort);
    }
  }

  const agentLocked = Boolean(activeSession?.runtimeSessionId ?? activeSession?.resume?.runtimeSessionId);

  useEffect(() => {
    if (!selectedProjectId && projects.length) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!draftProject) {
      return;
    }
    const defaultWorkspaceId = draftProject.defaultWorkspaceId;
    const nextWorkspaceId = defaultWorkspaceId && filteredWorkspaces.some((workspace) => workspace.id === defaultWorkspaceId)
      ? defaultWorkspaceId
      : filteredWorkspaces[0]?.id;
    if (nextWorkspaceId && nextWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceId(nextWorkspaceId);
    }
  }, [draftProject, filteredWorkspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (!draftProject) {
      return;
    }
    const defaultProjectAgentId = draftProject.defaultAgentId;
    const fallbackAgentId = defaultProjectAgentId && filteredAgents.some((agent) => agent.id === defaultProjectAgentId)
      ? defaultProjectAgentId
      : defaultAgentId(filteredAgents);
    if (fallbackAgentId && fallbackAgentId !== selectedAgentId) {
      setSelectedAgentId(fallbackAgentId);
    }
  }, [draftProject, filteredAgents, selectedAgentId]);

  useEffect(() => {
    if (!activeSessionId || pairingState !== "paired" || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    dispatch(socketRef.current, {
      type: "session.messages.list",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
    });
    dispatch(socketRef.current, {
      type: "session.artifacts.get",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
    });
    dispatch(socketRef.current, {
      type: "session.resume.check",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
    });
  }, [activeSessionId, pairingState]);

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(resolveViewFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function connectToDaemon(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const host = daemonHost.trim() || DEFAULT_DAEMON_HOST;
    const port = daemonPort.trim() || DEFAULT_DAEMON_PORT;
    const wsUrl = `ws://${host}:${port}`;

    window.localStorage.setItem(DAEMON_HOST_KEY, host);
    window.localStorage.setItem(DAEMON_PORT_KEY, port);
    socketRef.current?.close();
    setDebugTrace((current) => ({ ...current, connectClicks: current.connectClicks + 1 }));
    setConnection("connecting");
    setConnectFeedback(`${copy.connectFeedbackConnecting} (${wsUrl})`);
    setPairingState("idle");
    setPairingCodeInput("");
    setPairingFeedback(copy.pairingFeedbackIdle);

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setConnection("connected");
      setConnectFeedback(`已连接到 ${wsUrl}`);
      const token = window.localStorage.getItem(daemonTokenStorageKey(host, port));
      if (token) {
        dispatch(socket, { type: "device.auth", requestId: nextRequestId(requestCounter), token });
        setPairingState("waiting");
        setPairingFeedback("正在使用已保存令牌认证...");
        return;
      }
      setPairingState("input");
      setPairingFeedback(copy.pairingHint);
    });

    socket.addEventListener("close", () => {
      setConnection("disconnected");
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setConnectFeedback(copy.connectFeedbackIdle);
      if (pairingState !== "paired") {
        setPairingState("idle");
      }
    });

    socket.addEventListener("error", () => {
      setConnection("disconnected");
      setConnectFeedback(`连接 ${wsUrl} 失败`);
      setPairingState("idle");
    });

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as DaemonToClient;
      handleServerEvent(payload);
    });
  }

  function dispatch(socket: WebSocket, payload: ClientToDaemon) {
    socket.send(JSON.stringify(payload));
    setDebugTrace((current) => ({
      ...current,
      requestsSent: current.requestsSent + 1,
      lastRequestType: payload.type,
    }));
  }

  function handleServerEvent(payload: DaemonToClient) {
    switch (payload.type) {
      case "device.pair.result":
        if (payload.ok && payload.token) {
          window.localStorage.setItem(daemonTokenStorageKey(daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT), payload.token);
          setPairingFeedback(payload.message);
          setPairingState("paired");
          if (socketRef.current) {
            dispatch(socketRef.current, { type: "helm.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "project.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "workspace.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "agent.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "session.list", requestId: nextRequestId(requestCounter) });
          }
        } else {
          setPairingFeedback(payload.message);
          setPairingState("rejected");
        }
        return;
      case "device.auth.result":
        if (payload.ok) {
          setPairingFeedback(payload.message);
          setPairingState("paired");
          if (socketRef.current) {
            dispatch(socketRef.current, { type: "helm.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "project.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "workspace.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "agent.list", requestId: nextRequestId(requestCounter) });
            dispatch(socketRef.current, { type: "session.list", requestId: nextRequestId(requestCounter) });
          }
        } else {
          window.localStorage.removeItem(daemonTokenStorageKey(daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT));
          setPairingFeedback(payload.message);
          setPairingState("input");
        }
        return;
      case "helm.list.result":
        setHelms(payload.helms);
        return;
      case "project.list.result":
        setProjects(payload.projects);
        return;
      case "workspace.list.result":
        setWorkspaces(payload.workspaces);
        return;
      case "agent.list.result":
        setAgents(payload.agents);
        return;
      case "agent.test.result":
        setAgentTestResult(payload.message);
        return;
      case "agent.save.result":
        setConfigSaveMessage(payload.message);
        if (socketRef.current) {
          dispatch(socketRef.current, { type: "agent.list", requestId: nextRequestId(requestCounter) });
          dispatch(socketRef.current, { type: "project.list", requestId: nextRequestId(requestCounter) });
        }
        return;
      case "session.created":
        setSessions((current) => upsertSessionSummary(current, payload.session));
        setStatuses((current) => ({ ...current, [payload.session.id]: payload.session.status }));
        setSelectedProjectId(payload.session.projectId);
        if (payload.session.runtimeSessionId) {
          setActiveSessionId(payload.session.id);
          if (pendingPromptRef.current && socketRef.current) {
            const pendingPrompt = pendingPromptRef.current;
            pendingPromptRef.current = null;
            appendUserMessage(payload.session.id, pendingPrompt);
            dispatch(socketRef.current, {
              type: "session.prompt",
              requestId: nextRequestId(requestCounter),
              sessionId: payload.session.id,
              text: pendingPrompt,
            });
          }
        }
        return;
      case "session.updated":
        setSessions((current) => upsertSessionSummary(current, payload.session));
        return;
      case "session.list.result":
        setSessions((current) => mergeSessionSummaries(current, payload.sessions));
        setStatuses((current) => ({
          ...Object.fromEntries(payload.sessions.map((session) => [session.id, session.status] as const)),
          ...current,
        }));
        setActiveSessionId((current) => current ?? payload.sessions[0]?.id ?? null);
        return;
      case "session.messages.list.result":
        setMessages((current) => ({
          ...current,
          [payload.sessionId]: mergeMessageHistory(current[payload.sessionId] ?? [], payload.messages),
        }));
        return;
      case "session.artifacts.result":
        setOutputs((current) => ({
          ...current,
          [payload.sessionId]: mergeCommandHistory(current[payload.sessionId] ?? [], payload.outputs),
        }));
        setDiffs((current) => ({ ...current, [payload.sessionId]: payload.diffs }));
        return;
      case "session.resume.result":
        setSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId
              ? {
                  ...session,
                  resume: payload.resume,
                  runtimeSessionId: payload.resume.runtimeSessionId ?? session.runtimeSessionId,
                }
              : session,
          ),
        );
        return;
      case "session.resume.start.result":
        setResumeFeedback(payload.message);
        setSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId
              ? {
                  ...session,
                  resume: payload.resume,
                  runtimeSessionId: payload.resume.runtimeSessionId ?? session.runtimeSessionId,
                }
              : session,
          ),
        );
        return;
      case "session.cleanup.result":
        setCleanupFeedback(resolveCleanupFeedback(payload.result));
        setResumeFeedback("");
        setSessions((current) => current.filter((session) => session.id !== payload.result.sessionId));
        setStatuses((current) => removeSessionRecord(current, payload.result.sessionId));
        setMessages((current) => removeSessionRecord(current, payload.result.sessionId));
        setPermissionRequests((current) => removeSessionRecord(current, payload.result.sessionId));
        setOutputs((current) => removeSessionRecord(current, payload.result.sessionId));
        setDiffs((current) => removeSessionRecord(current, payload.result.sessionId));
        setActiveSessionId((current) => (current === payload.result.sessionId ? null : current));
        return;
      case "session.status":
        setStatuses((current) => ({ ...current, [payload.sessionId]: payload.status }));
        setSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId
              ? {
                  ...session,
                  status: payload.status,
                  updatedAt: new Date().toISOString(),
                }
              : session,
          ),
        );
        return;
      case "agent.message":
        setMessages((current) => ({
          ...current,
          [payload.sessionId]: mergeAgentMessages(current[payload.sessionId] ?? [], payload.message),
        }));
        setSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId
              ? {
                  ...session,
                  updatedAt: payload.message.timestamp,
                  messageCount: session.messageCount + 1,
                  lastMessagePreview: payload.message.text.slice(0, 160),
                }
              : session,
          ),
        );
        return;
      case "permission.request":
        setPermissionRequests((current) => ({ ...current, [payload.sessionId]: payload.permissionRequest }));
        return;
      case "permission.resolved":
        setPermissionRequests((current) => ({ ...current, [payload.sessionId]: null }));
        return;
      case "command.output":
        setOutputs((current) => ({
          ...current,
          [payload.sessionId]: [...(current[payload.sessionId] ?? []), payload.chunk],
        }));
        return;
      case "diff.update":
        setDiffs((current) => ({ ...current, [payload.sessionId]: payload.files }));
        return;
      case "error":
        setPairingFeedback(payload.message);
        if (payload.message.toLowerCase().includes("not paired")) {
          setPairingState("input");
        }
        if (payload.sessionId) {
          appendSystemMessage(payload.sessionId, payload.message);
          setSessions((current) =>
            current.map((session) =>
              session.id === payload.sessionId
                ? {
                    ...session,
                    status: "error",
                    updatedAt: new Date().toISOString(),
                    lastMessagePreview: payload.message.slice(0, 160),
                  }
                : session,
            ),
          );
        }
        return;
      default:
        return;
    }
  }

  function appendSystemMessage(sessionId: string, text: string) {
    setMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []),
        {
          id: `${sessionId}-system-${Date.now()}`,
          role: "system",
          text,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
  }

  function appendUserMessage(sessionId: string, text: string) {
    setMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []),
        {
          id: `${sessionId}-user-${Date.now()}`,
          role: "user",
          text,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
  }

  function createSession(initialPrompt?: string) {
    const projectId = selectedProjectId || projects[0]?.id;
    const workspaceId = selectedWorkspaceId || filteredWorkspaces[0]?.id;
    const agentId = selectedAgentId || filteredAgents[0]?.id;
    if (!projectId || !workspaceId || !agentId || !socketRef.current) {
      return false;
    }

    pendingPromptRef.current = initialPrompt ?? null;
    dispatch(socketRef.current, {
      type: "session.create",
      requestId: nextRequestId(requestCounter),
      projectId,
      workspaceId,
      agentId,
      model: normalizeModelSelection(selectedModel),
      reasoningEffort: selectedReasoningEffort,
    });
    navigateToView("sessions");
    return true;
  }

  function testAgent() {
    const agentId = selectedAgentId || filteredAgents[0]?.id;
    const agent = filteredAgents.find((item) => item.id === agentId) ?? agents.find((item) => item.id === agentId);
    if (!agent || !socketRef.current) {
      return;
    }

    setAgentTestResult(`${copy.testRunningPrefix} ${agent.name}...`);
    dispatch(socketRef.current, {
      type: "agent.test",
      requestId: nextRequestId(requestCounter),
      providerId: agent.id,
    });
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.localStorage.setItem(AGENT_DRAFT_STORAGE_KEY, JSON.stringify(agentDraft));
    setDraftSaveMessage(`${copy.savedDraft} ${`${agentDraft.command} ${agentDraft.args}`.trim()}`);
  }

  function writeDraftToConfig() {
    if (!socketRef.current) {
      return;
    }

    const providerId = slugify(agentDraft.name || agentDraft.command || "custom-agent");
    setConfigSaveMessage(copy.writingConfig);
    dispatch(socketRef.current, {
      type: "agent.save",
      requestId: nextRequestId(requestCounter),
      provider: {
        id: providerId,
        name: agentDraft.name || providerId,
        kind: "custom",
        command: agentDraft.command,
        args: splitArgs(agentDraft.args),
        installHint: `请确认命令 \`${agentDraft.command} ${agentDraft.args}\` 可以在终端运行。`,
      },
    });
  }


  function saveDaemonProfile() {
    const host = daemonHost.trim() || DEFAULT_DAEMON_HOST;
    const port = daemonPort.trim() || DEFAULT_DAEMON_PORT;
    const name = daemonProfileName.trim() || `${host}:${port}`;
    const profile: DaemonProfile = {
      id: slugify(`${name}-${host}-${port}`),
      name,
      host,
      port,
    };
    const nextProfiles = [...daemonProfiles.filter((item) => item.id !== profile.id), profile];
    setDaemonProfiles(nextProfiles);
    setDaemonProfileName(name);
    setDaemonProfileMessage(`已保存 Daemon：${name}`);
    window.localStorage.setItem(DAEMON_PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
  }

  function applyDaemonProfile(profile: DaemonProfile) {
    setDaemonHost(profile.host);
    setDaemonPort(profile.port);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(`已切换到 ${profile.name}`);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || !socketRef.current) {
      return;
    }

    if (!activeSessionId) {
      if (createSession(nextPrompt)) {
        setPrompt("");
      }
      return;
    }

    appendUserMessage(activeSessionId, nextPrompt);
    setPrompt("");
    dispatch(socketRef.current, {
      type: "session.prompt",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
      text: nextPrompt,
    });
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

  function updatePairingDigit(index: number, rawValue: string) {
    const nextChar = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);
    const chars = pairingCodeInput.padEnd(6, " ").split("");
    chars[index] = nextChar || " ";
    const nextValue = chars.join("").trimEnd();
    setPairingCodeInput(nextValue);
    if (nextChar && index < 5) {
      pairInputRefs.current[index + 1]?.focus();
    }
    if (pairingState === "rejected") {
      setPairingState("input");
    }
  }

  function pastePairingDigits(startIndex: number, rawValue: string) {
    const charsOnly = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6 - startIndex);
    if (!charsOnly) {
      return;
    }

    const chars = pairingCodeInput.padEnd(6, " ").split("");
    for (let offset = 0; offset < charsOnly.length; offset += 1) {
      chars[startIndex + offset] = charsOnly[offset] ?? " ";
    }
    setPairingCodeInput(chars.join("").trimEnd());
    const focusIndex = Math.min(startIndex + charsOnly.length, 5);
    pairInputRefs.current[focusIndex]?.focus();
    if (pairingState === "rejected") {
      setPairingState("input");
    }
  }

  function handlePairingKeyDown(index: number, key: string) {
    if (key === "Backspace" && !pairingCodeInput[index] && index > 0) {
      pairInputRefs.current[index - 1]?.focus();
    }
  }

  function sendPairingRequest() {
    const socket = socketRef.current;
    const normalizedCode = pairingCodeInput.trim().toUpperCase();
    if (!socket || normalizedCode.length !== 6 || socket.readyState !== WebSocket.OPEN) {
      setPairingFeedback(`无法发送配对请求，socket=${socket ? socket.readyState : "null"}`);
      return;
    }

    setDebugTrace((current) => ({ ...current, pairClicks: current.pairClicks + 1 }));
    setPairingFeedback(`正在发送配对请求：${normalizedCode}...`);
    dispatch(socket, {
      type: "device.pair",
      requestId: nextRequestId(requestCounter),
      pairingCode: normalizedCode,
    });
    setPairingState("waiting");
  }

  function submitPairingCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendPairingRequest();
  }

  function startResume() {
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

  function cancelSession() {
    if (!activeSessionId || !socketRef.current) {
      return;
    }

    dispatch(socketRef.current, {
      type: "session.cancel",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
    });
  }

  function cleanupSession(targetSessionId = activeSessionId) {
    if (!targetSessionId || !socketRef.current) {
      return;
    }

    const confirmed = window.confirm("将清理当前 Mission 的本地记录；若该 Mission 由 Tiller 创建且 provider 支持，也会尝试删除远端 ACP session。确认继续吗？");
    if (!confirmed) {
      return;
    }

    setCleanupFeedback({ tone: "info", message: "正在清理当前 Mission..." });
    dispatch(socketRef.current, {
      type: "session.cleanup",
      requestId: nextRequestId(requestCounter),
      sessionId: targetSessionId,
    });
  }

  function renderConnectionPanel() {
    return (
      <section className="card pairing-card">
        <h2>{showConnectionCard ? copy.connectDaemon : copy.pairingTitle}</h2>
        <p className="muted">{showConnectionCard ? copy.connectHint : copy.pairingHint}</p>

        {showConnectionCard && (
          <div className="stack-gap">
            <form className="connect-form" onSubmit={connectToDaemon}>
              <label>
                <span>{copy.daemonAddress}</span>
                <input value={daemonHost} onChange={(event) => setDaemonHost(event.target.value)} placeholder={DEFAULT_DAEMON_HOST} />
              </label>
              <label>
                <span>{copy.daemonPort}</span>
                <input value={daemonPort} onChange={(event) => setDaemonPort(event.target.value.replace(/[^0-9]/g, ""))} placeholder={DEFAULT_DAEMON_PORT} />
              </label>
              <button className="primary" type="submit">
                {connection === "connecting" ? copy.connection.connecting : copy.connectDaemon}
              </button>
            </form>

            <div className="note-box compact-note">
              <strong>多 Daemon 预设</strong>
              <label>
                <span>预设名称</span>
                <input value={daemonProfileName} onChange={(event) => setDaemonProfileName(event.target.value)} placeholder="工作室 Daemon" />
              </label>
              <div className="section-actions">
                <button className="secondary" type="button" onClick={saveDaemonProfile}>
                  保存当前 Daemon
                </button>
              </div>
              {daemonProfiles.length ? (
                <div className="stack-gap">
                  {daemonProfiles.map((profile) => (
                    <button key={profile.id} className="secondary" type="button" onClick={() => applyDaemonProfile(profile)}>
                      {profile.name} · {profile.host}:{profile.port}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted compact">还没有保存的 Daemon 预设。</p>
              )}
              {daemonProfileMessage ? <p className="subtle compact">{daemonProfileMessage}</p> : null}
            </div>
          </div>
        )}

        {showPairingCard && (
          <form className="pairing-form" onSubmit={submitPairingCode}>
            <PairingBoxes
              refs={pairInputRefs}
              value={pairingCodeInput}
              disabled={pairingState === "waiting"}
              onChange={updatePairingDigit}
              onKeyDown={handlePairingKeyDown}
              onPaste={pastePairingDigits}
            />
            <button className="primary" type="button" onClick={sendPairingRequest} disabled={pairingCodeInput.length !== 6 || pairingState === "waiting"}>
              {pairingState === "waiting" ? "配对中..." : "配对"}
            </button>
          </form>
        )}

        <div className="note-box compact-note">
          <strong>{showConnectionCard ? copy.connectDaemon : copy.pairingTitle}</strong>
          <p>{showConnectionCard ? connectFeedback : pairingFeedback}</p>
        </div>

        <div className="note-box compact-note">
          <strong>{copy.pairingDebug}</strong>
          <p>
            连接次数={debugTrace.connectClicks} · 配对次数={debugTrace.pairClicks} · 请求数={debugTrace.requestsSent}
          </p>
          <p className="muted compact">最近请求类型={debugTrace.lastRequestType}</p>
        </div>

        {pairingState === "rejected" && <p className="error-text">配对失败，请检查配对码后重试。</p>}
      </section>
    );
  }

  const showConnectionCard = connection !== "connected" && pairingState !== "paired";
  const showPairingCard = connection === "connected" && pairingState !== "paired";

  function renderOverview() {
    const recentSessions = resolvedSessions.slice(0, 5);
    return (
      <section className="workspace-single">
        <header className="hero card hero-panel">
          <div>
            <p className="eyebrow">ACP Coding Agent 舰队指挥甲板</p>
            <h1>Tiller Deck</h1>
            <p className="muted hero-copy">Tiller 是你的 ACP Coding Agent 舰队指挥甲板：调度 Mission、审批权限、追踪 Logbook 与文件变更。</p>
          </div>
          <div className="hero-metrics overview-stats">
            <StatCard label="Project" value={String(projects.length)} meta={projects[0]?.name ?? "暂无 Project"} />
            <StatCard label="Workspace" value={String(workspaces.length)} meta={workspaces[0]?.name ?? copy.noWorkspaces} />
            <StatCard label="Crew" value={String(agents.length)} meta={agents[0]?.name ?? copy.noAgents} />
            <StatCard label="活跃 Mission" value={String(sessions.length)} meta={activeStatus} />
          </div>
        </header>

        <div className="meta-grid">
          <section className="card surface-card stack-gap">
            <div className="section-head section-head-soft">
              <div>
                <h2>Project 列表</h2>
                <p className="muted compact">只读展示当前 Deck 可见的 Project 及其绑定 Helm。</p>
              </div>
            </div>
            <InfoList items={projects.map((project) => `${project.name} · ${helms.find((helm) => helm.id === project.helmId)?.name ?? project.helmId}`)} empty="暂无 Project" />
          </section>

          <section className="card surface-card stack-gap">
            <div className="section-head section-head-soft">
              <div>
                <h2>工作区列表</h2>
                <p className="muted compact">只读展示当前 Helm 暴露的 Workspace。</p>
              </div>
            </div>
            <InfoList items={workspaces.map((workspace) => `${workspace.name} · ${workspace.path}`)} empty={copy.noWorkspaces} />
          </section>

          <section className="card surface-card stack-gap">
            <div className="section-head section-head-soft">
              <div>
                <h2>Crew 列表</h2>
                <p className="muted compact">只读展示当前可用的 ACP Crew。</p>
              </div>
            </div>
            <InfoList items={agents.map((agent) => `${agent.name} · ${agent.command} ${(agent.args ?? []).join(" ")}`.trim())} empty={copy.noAgents} />
          </section>
        </div>

        <section className="card surface-card stack-gap">
          <div className="section-head section-head-soft">
            <div>
              <h2>最近 Mission</h2>
              <p className="muted compact">最近 5 条 Mission 记录，只读展示。</p>
            </div>
          </div>
          {recentSessions.length ? (
            <div className="session-history-list read-only-list">
              {recentSessions.map((session) => (
                <article key={session.id} className="session-item session-history-item read-only-item">
                  <span className="session-item-main">
                    <strong>{session.projectName}</strong>
                    <span className="subtle">{session.workspaceName} · {session.agentName} · {formatSessionTime(session.updatedAt)}</span>
                    <span className="subtle">{session.lastMessagePreview ?? "暂无消息预览"}</span>
                  </span>
                  <span className="session-history-meta">
                    <span className="status-chip">{copy.status[statuses[session.id] ?? session.status]}</span>
                    <span className="subtle">{session.messageCount} 条消息</span>
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">{copy.noSessions}</div>
          )}
        </section>
      </section>
    );
  }

  function renderPlainMessages(items: AgentMessage[]) {
    if (!items.length) {
      return <div className="empty-state">{copy.waitingForAgent}</div>;
    }

    return (
      <div className="plain-message-list">
        {items.map((item) => (
          <article key={item.id} className={`plain-message plain-${item.role}`}>
            <span className="plain-message-role">{copy.role[item.role]}</span>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    );
  }

  function renderSessions() {
    const canSend = Boolean(prompt.trim() && socketRef.current && (activeSessionId || (selectedProjectId && selectedWorkspaceId && selectedAgentId)));
    return (
      <section className="card surface-card chat-layout chat-layout-sidebar">
        {pairingState !== "paired" ? (
          <div className="note-box compact-note">
            <strong>Mission 视图待连接</strong>
            <p>请先在 Crew 页连接并配对 Helm，再返回这里下达指令。</p>
          </div>
        ) : (
          <>
            <aside className="chat-session-sidebar" aria-label="Mission 列表">
              <div className="sidebar-section project-switcher">
                <div className="section-head section-head-soft sidebar-heading-block">
                  <div>
                    <h2>Project</h2>
                    <p className="muted compact">先选 Project，再进入该 Project 下的 Mission。</p>
                  </div>
                </div>
                <div className="project-nav-list">
                  {projects.map((project) => {
                    const selected = project.id === selectedProjectId;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={`project-nav-item ${selected ? "active" : ""}`}
                        onClick={() => selectProject(project.id)}
                      >
                        <strong>{project.name}</strong>
                        <span>{sessionCountsByProject[project.id] ?? 0} Mission</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sidebar-section session-switcher">
                <div className="section-head section-head-soft sidebar-heading-block">
                  <div>
                    <h2>Mission</h2>
                    <p className="muted compact">当前 Project：{draftProject?.name ?? "未选择"}</p>
                  </div>
                </div>
                <button type="button" className={`chat-session-item ${!activeSession ? "active" : ""}`} onClick={() => setActiveSessionId(null)}>
                  <strong>新 Mission</strong>
                  <span>{draftProject ? `在 ${draftProject.name} 下创建新的会话` : "先选择 Project"}</span>
                </button>
                {projectSessions.length ? (
                  projectSessions.map((session) => (
                    <div key={session.id} className={`session-nav-card ${session.id === activeSessionId ? "active" : ""}`}>
                      <button type="button" className="chat-session-item session-nav-button" onClick={() => openSession(session.id)}>
                        <span className="session-nav-title-row">
                          <strong>{resolveSessionTitle(session)}</strong>
                          <span className="session-nav-time">{formatRelativeTime(session.updatedAt)}</span>
                        </span>
                        <span>{session.agentName} · {copy.status[statuses[session.id] ?? session.status]}</span>
                        <span>{session.lastMessagePreview ?? `${session.workspaceName} · ${session.model ?? "provider-default"}`}</span>
                      </button>
                      <button
                        type="button"
                        className="session-inline-action"
                        aria-label={`清理 ${resolveSessionTitle(session)}`}
                        title="清理 Mission"
                        onClick={(event) => {
                          event.stopPropagation();
                          cleanupSession(session.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state sidebar-empty">这个 Project 还没有 Mission。</div>
                )}
              </div>
            </aside>

            <div className="chat-conversation">
              <div className="chat-main">
                {activeSession ? (
                  <>
                    <div className="section-head section-head-soft chat-session-head">
                      <div>
                        <h2>{resolveSessionTitle(activeSession)}</h2>
                        <p className="muted compact">{activeSession.projectName} · {activeSession.workspaceName} · {activeStatus}</p>
                        <p className="subtle compact">Helm：{helms.find((helm) => helm.id === activeSession.helmId)?.name ?? activeSession.helmId}</p>
                        <p className="subtle compact">ACP：{activeSession.agentName} · Model：{activeSession.model ?? "provider-default"} · Reasoning：{activeSession.reasoningEffort ?? "medium"}</p>
                        <p className="subtle compact">ACP Mission ID：{activeSession.runtimeSessionId ?? activeSession.resume?.runtimeSessionId ?? "等待 runtime 返回"}</p>
                        {cleanupFeedback ? <p className={`compact cleanup-feedback cleanup-${cleanupFeedback.tone}`}>{cleanupFeedback.message}</p> : null}
                        {resumeFeedback ? <p className="subtle compact">{resumeFeedback}</p> : null}
                      </div>
                      <div className="section-actions">
                        <button className="secondary" type="button" onClick={startResume}>恢复/重连</button>
                        <button className="secondary" type="button" onClick={cancelSession}>取消 Mission</button>
                      </div>
                    </div>

                    {pendingPermission ? (
                      <section className="permission-card">
                        <div>
                          <p className="eyebrow">{copy.permissionRequest}</p>
                          <strong>{pendingPermission.command}</strong>
                          <p className="muted compact">{pendingPermission.reason}</p>
                          <p className="subtle compact">{pendingPermission.workspacePath}</p>
                        </div>
                        <div className="permission-actions">
                          <button className="primary" type="button" onClick={() => respondToPermission("allow")}>{copy.allowOnce}</button>
                          <button className="secondary" type="button" onClick={() => respondToPermission("deny")}>{copy.deny}</button>
                        </div>
                      </section>
                    ) : null}

                    {renderPlainMessages(messages[activeSession.id] ?? [])}

                    <details className="chat-collapsible">
                      <summary>{copy.commandOutput}</summary>
                      <CommandOutput items={outputs[activeSession.id] ?? []} emptyLabel={copy.noCommandOutput} />
                    </details>
                    <details className="chat-collapsible">
                      <summary>{copy.diffSummary}</summary>
                      <DiffSummary items={diffs[activeSession.id] ?? []} emptyLabel={copy.noDiffSummary} />
                    </details>
                  </>
                ) : (
                  <div className="chat-empty">
                    <p className="eyebrow">新 Mission</p>
                    <h2>{draftProject ? `在 ${draftProject.name} 下创建新的 Mission` : "先在左侧选择一个 Project"}</h2>
                    <p className="muted">左侧上半是 Project，下半是该 Project 的 Mission。底部草稿栏里锁定 ACP，可继续调整 Model / Reasoning。</p>
                    {cleanupFeedback ? <p className={`compact cleanup-feedback cleanup-${cleanupFeedback.tone}`}>{cleanupFeedback.message}</p> : null}
                  </div>
                )}
              </div>

              <div className="chat-input-area draft-toolbar">
                <div className="draft-toolbar-grid">
                  <label>
                    <span>Project</span>
                    <input value={draftProject?.name ?? "未选择 Project"} readOnly />
                  </label>
                  <label>
                    <span>{copy.selectedWorkspace}</span>
                    <select value={activeSession?.workspaceId ?? selectedWorkspaceId ?? ""} onChange={(event) => setSelectedWorkspaceId(event.target.value)} disabled={Boolean(activeSession)}>
                      {filteredWorkspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{copy.selectedAgent}</span>
                    <select value={activeSession?.agentId ?? selectedAgentId ?? ""} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={agentLocked}>
                      {filteredAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Model</span>
                    <input
                      list="session-model-options"
                      value={draftModel}
                      onChange={(event) => updateSessionDraftPreferences({ model: event.target.value })}
                      placeholder={draftModelPlaceholder}
                    />
                    <datalist id="session-model-options">
                      {resolveModelOptions(draftModel).map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span>Reasoning</span>
                    <select
                      value={draftReasoningEffort}
                      onChange={(event) => updateSessionDraftPreferences({ reasoningEffort: event.target.value as SessionReasoningEffort })}
                    >
                      {REASONING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <form className="chat-input-form mission-order-editor" onSubmit={submitPrompt}>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={activeSession ? "向当前 Mission 下达 Order；Model / Reasoning 可继续调整，ACP 已锁定" : "输入第一条 Order，发送后自动创建 Mission"}
                  />
                  <button className="primary" type="submit" disabled={!canSend}>发送</button>
                  <p className="order-editor-hint">左栏按 Project 管理 Mission；ACP 在会话成立后锁定，Model / Reasoning 作为当前 session 配置可继续调整。{draftConfigHint}</p>
                </form>
              </div>
            </div>
          </>
        )}
      </section>
    );
  }

  function renderAgents() {
    return (
      <section className="workspace-single">
        {(showConnectionCard || showPairingCard) ? renderConnectionPanel() : null}
        <section className="card surface-card stack-gap">
          <div className="section-head section-head-soft">
            <div>
              <h2>Crew</h2>
              <p className="muted compact">管理本地 ACP Crew 配置草稿，并查看当前 Helm 返回的 Crew 列表。</p>
            </div>
            <button className="secondary" type="button" onClick={testAgent} disabled={connection !== "connected" || !agents.length}>测试 Crew 连接</button>
          </div>

          <InfoList title="Agent 列表" items={agents.map((agent) => `${agent.name} · ${agent.command} ${(agent.args ?? []).join(" ")}`.trim())} empty={copy.noAgents} />
        </section>

        <section className="card surface-card stack-gap">
          <form className="config-form" onSubmit={saveDraft}>
            <div className="section-head">
              <h3>{copy.addAgentDraft}</h3>
              <div className="section-actions">
                <button className="secondary" type="submit">本地保存草稿</button>
                <button className="primary" type="button" onClick={writeDraftToConfig} disabled={connection !== "connected" || !agentDraft.command.trim()}>写入 Daemon 配置</button>
              </div>
            </div>

            <label>
              <span>{copy.name}</span>
              <input value={agentDraft.name} onChange={(event) => setAgentDraft((current) => ({ ...current, name: event.target.value }))} placeholder="OpenCode" />
            </label>
            <label>
              <span>{copy.command}</span>
              <input value={agentDraft.command} onChange={(event) => setAgentDraft((current) => ({ ...current, command: event.target.value }))} placeholder="opencode" />
            </label>
            <label>
              <span>{copy.arguments}</span>
              <input value={agentDraft.args} onChange={(event) => setAgentDraft((current) => ({ ...current, args: event.target.value }))} placeholder="acp --pure" />
            </label>

            <div className="meta-grid">
              <InfoList title={copy.draftOnlyTitle} items={[copy.draftOnlyHint, draftSaveMessage]} empty={copy.draftOnlyHint} />
              <InfoList title={copy.daemonConfigTitle} items={[copy.daemonConfigHint, configSaveMessage, `${copy.agentTestTitle}: ${agentTestResult}`]} empty={copy.daemonConfigHint} />
            </div>
          </form>
        </section>

        <section className="note-box compact-note">
          <strong>Daemon 管理功能即将推出。</strong>
          <p className="muted compact">后续会在这里管理多 Daemon 生命周期、健康检查与切换策略。</p>
        </section>
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="workspace-single">
        <section className="card surface-card stack-gap">
          <div className="section-head section-head-soft">
            <div>
              <h2>设置</h2>
              <p className="muted compact">这里保留偏好设置，不再混放 Daemon 管理。</p>
            </div>
          </div>

          <div className="settings-grid">
            <section className="note-box settings-card">
              <p className="eyebrow">语言</p>
              <h3>简体中文</h3>
              <p className="muted compact">当前版本主界面固定使用中文；后续可在这里加入多语言切换。</p>
            </section>
            <section className="note-box settings-card">
              <p className="eyebrow">样式</p>
              <h3>浅色玻璃态</h3>
              <p className="muted compact">当前使用浅色、圆角、柔和阴影风格；后续可扩展深色模式和紧凑模式。</p>
            </section>
            <section className="note-box settings-card">
              <p className="eyebrow">显示密度</p>
              <h3>标准</h3>
              <p className="muted compact">会话列表和详情区域使用标准间距，便于移动端阅读。</p>
            </section>
          </div>
        </section>
      </section>
    );
  }

  return (
    <main className="shell">
      <TopNav activeView={activeView} onNavigate={navigateToView} connection={connection} />
      <div className="page-content stack-gap">
        {activeView === "overview" && renderOverview()}
        {activeView === "sessions" && renderSessions()}
        {activeView === "agents" && renderAgents()}
        {activeView === "settings" && renderSettings()}
      </div>
    </main>
  );
}

function resolveViewFromPath(pathname: string): AppView {
  const normalized = pathname.replace(/\/+$/g, "") || "/";
  const matched = (Object.entries(VIEW_PATHS) as Array<[AppView, string]>).find(([, path]) => path === normalized);
  return matched?.[0] ?? "overview";
}

function nextRequestId(counter: MutableRefObject<number>) {
  counter.current += 1;
  return `req-${counter.current}`;
}

function removeSessionRecord<T>(records: Record<string, T>, sessionId: string) {
  const { [sessionId]: _removed, ...rest } = records;
  return rest;
}

function resolveCleanupFeedback(result: Extract<DaemonToClient, { type: "session.cleanup.result" }>['result']): CleanupFeedback {
  if (result.remoteDeleted) {
    return { tone: "success", message: result.message };
  }

  if (result.remoteDeletionAttempted) {
    return { tone: "warning", message: result.message };
  }

  return { tone: "info", message: result.message };
}

function mergeAgentMessages(items: AgentMessage[], incoming: AgentMessage) {
  const last = items.at(-1);
  if (!last) {
    return [incoming];
  }

  if (last.role === incoming.role && last.role !== "system") {
    return [
      ...items.slice(0, -1),
      {
        ...last,
        text: `${last.text}${incoming.text}`,
        timestamp: incoming.timestamp,
      },
    ];
  }

  if (last.role === "system" && incoming.role === "system" && last.text === incoming.text) {
    return items;
  }

  return [...items, incoming];
}

function mergeMessageHistory(current: AgentMessage[], incoming: AgentMessage[]) {
  const merged = [...current];
  for (const message of incoming) {
    if (!merged.some((item) => item.id === message.id)) {
      merged.push(message);
    }
  }

  return merged.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeCommandHistory(current: CommandChunk[], incoming: CommandChunk[]) {
  const merged = [...current];
  for (const chunk of incoming) {
    if (!merged.some((item) => item.id === chunk.id)) {
      merged.push(chunk);
    }
  }

  return merged.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeSessionSummaries(current: SessionSummary[], incoming: SessionSummary[]) {
  return incoming.reduce((items, summary) => upsertSessionSummary(items, summary), current);
}

function upsertSessionSummary(current: SessionSummary[], incoming: SessionSummary) {
  return [...current.filter((session) => session.id !== incoming.id), incoming].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

function formatResumeLabel(resume: SessionSummary["resume"], locale: Locale) {
  if (!resume) {
    return "恢复状态待检查";
  }

  switch (resume.state) {
    case "resume-available":
      return "可恢复";
    case "resume-unavailable":
      return "暂不可恢复";
    case "history-only":
    default:
      return "仅历史记录";
  }
}

function daemonTokenStorageKey(host: string, port: string) {
  return `tiller.session-token.${host}.${port}`;
}

function formatDaemonProfileLine(
  profile: DaemonProfile,
  currentHost: string,
  currentPort: string,
  connection: "connecting" | "connected" | "disconnected",
  locale: Locale,
) {
  const isCurrent = profile.host === currentHost && profile.port === currentPort;
  const status = isCurrent ? formatConnectionStatus(connection) : "已保存";
  return `${profile.name} · ${profile.host}:${profile.port} · ${status}`;
}

function formatConnectionStatus(connection: "connecting" | "connected" | "disconnected") {
  return connection === "connected" ? "已连接" : connection === "connecting" ? "连接中" : "已断开";
}

function formatPairingState(state: "idle" | "waiting" | "input" | "paired" | "rejected") {
  const labels = {
    idle: "未开始",
    waiting: "等待中",
    input: "等待输入",
    paired: "已配对",
    rejected: "已拒绝",
  } as const;
  return labels[state];
}

function readDaemonProfiles(): DaemonProfile[] {
  try {
    const raw = window.localStorage.getItem(DAEMON_PROFILE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is DaemonProfile => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.host === "string" &&
        typeof candidate.port === "string"
      );
    });
  } catch {
    return [];
  }
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom-agent";
}

function splitArgs(value: string) {
  return value
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function alignSessionProject(session: SessionSummary, projects: ProjectSummary[]) {
  const exactProject = projects.find((project) => project.id === session.projectId);
  if (exactProject) {
    if (session.projectName === exactProject.name) {
      return session;
    }
    return {
      ...session,
      projectName: exactProject.name,
      helmId: session.helmId === exactProject.helmId ? session.helmId : exactProject.helmId,
    };
  }

  const matchedProject = projects.find((project) => project.name === session.projectName)
    ?? projects.find((project) => project.workspaceIds?.includes(session.workspaceId));
  if (!matchedProject) {
    return session;
  }

  return {
    ...session,
    projectId: matchedProject.id,
    projectName: matchedProject.name,
    helmId: matchedProject.helmId,
  };
}

function resolveSessionTitle(session: SessionSummary) {
  const preview = session.lastMessagePreview?.trim();
  if (preview) {
    return preview.split(/\r?\n/u)[0]?.slice(0, 36) ?? preview;
  }

  return `${session.projectName} Mission`;
}

function resolveModelOptions(currentModel?: string) {
  const options = [...MODEL_OPTIONS];
  if (currentModel && !options.includes(currentModel as (typeof MODEL_OPTIONS)[number])) {
    return [currentModel, ...options];
  }
  return options;
}

function normalizeModelSelection(model: string | undefined) {
  return model && model !== "provider-default" ? model : undefined;
}

function defaultAgentId(agents: AcpAgentProvider[]) {
  return agents[0]?.id ?? null;
}

function formatRelativeTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  const diffMinutes = Math.max(1, Math.round((Date.now() - parsed) / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

function resolveSessionConfigHint(
  activeSession: SessionSummary | null,
  agents: AcpAgentProvider[],
  draftAgentId?: string | null,
) {
  const provider = agents.find((agent) => agent.id === (activeSession?.agentId ?? draftAgentId));
  const support = resolveSessionConfigSupport(provider);

  if (support.model === "startup" && support.reasoningEffort === "startup") {
    return activeSession
      ? " 该 provider 会在下次 runtime 启动/恢复时应用 Model 与 Reasoning 覆盖。"
      : " 该 provider 的新会话会直接写入 Model / Reasoning。";
  }

  if (support.model === "startup" && support.reasoningEffort === "none") {
    return activeSession
      ? " 该 provider 会在下次 runtime 启动/恢复时应用 Model 覆盖；若当前 provider/model 支持 reasoningEffort，Tiller 也会通过 inline config 尝试带入，否则仍只保存在 session 配置中。模型请使用 provider/model 形式，例如 openai/gpt-5.4。"
      : " 该 provider 的新会话支持写入 Model；若当前 provider/model 支持 reasoningEffort，Tiller 也会通过 inline config 尝试带入，否则仅保存在 session 配置中。模型请使用 provider/model 形式，例如 openai/gpt-5.4。";
  }

  return activeSession
    ? " 当前 provider 暂未暴露通用的运行时 Model/Reasoning 热切换接口，Tiller 会先保存为 session 配置。"
    : " 新会话会尽量把这些配置带入 provider。";
}

function resolveModelInputPlaceholder(
  activeSession: SessionSummary | null,
  agents: AcpAgentProvider[],
  draftAgentId?: string | null,
) {
  const provider = agents.find((agent) => agent.id === (activeSession?.agentId ?? draftAgentId));
  const support = resolveSessionConfigSupport(provider);
  return support.modelFormat === "provider/model" ? "provider-default 或 openai/gpt-5.4" : "provider-default 或 gpt-5.4";
}

function formatSessionTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}


