import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import type { ClientToDaemon, DaemonToClient } from "@tiller/sync-protocol";
import type {
  AcpAgentProvider,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { CommandOutput, DiffSummary, InfoList, MessageStream, PairingBoxes, Panel, SessionRecordList, StatCard } from "./ui";

const DEFAULT_DAEMON_HOST = "127.0.0.1";
const DEFAULT_DAEMON_PORT = "47631";
const AGENT_DRAFT_STORAGE_KEY = "tiller.agent-draft";
const DAEMON_HOST_KEY = "tiller.daemon-host";
const DAEMON_PORT_KEY = "tiller.daemon-port";
const DAEMON_PROFILE_STORAGE_KEY = "tiller.daemon-profiles";
const UI_COPY = {
  "zh-CN": {
    localeLabel: "中文",
    localeSwitch: "English",
    heroEyebrow: "ACP 优先的移动控制面",
    heroBody: "面向任意 ACP 兼容 Coding Agent 的真实控制台。当前默认走真实 ACP session，并保留最小协议归一化层来接入不同实现。",
    connection: {
      connecting: "连接中",
      connected: "已连接",
      disconnected: "已断开",
    },
    daemonAddress: "Daemon 地址",
    daemonPort: "端口",
    connectDaemon: "连接 Daemon",
    reconnectDaemon: "重新连接",
    connectHint: "先填写你的 daemon 地址和端口，再主动连接。连接成功后才进入配对流程。",
    connectFeedbackIdle: "尚未连接 daemon。",
    connectFeedbackConnecting: "正在连接 daemon...",
    pairingTitle: "设备配对",
    pairingHint: "连接成功后，请输入 daemon 终端显示的 6 位配对码。",
    pairingFeedbackIdle: "等待输入配对码。",
    pairingDebug: "调试回显",
    controlPlane: "控制面",
    testConfiguredAgent: "测试当前 ACP",
    createSession: "创建会话",
    selectedWorkspace: "工作区",
    selectedAgent: "Agent",
    workspaces: "工作区",
    agents: "ACP Agent",
    noWorkspaces: "暂无工作区",
    noAgents: "暂无 Agent",
    addAgentDraft: "添加 ACP Agent 配置",
    saveDraftLocal: "保存本地配置草稿",
    writeDaemonConfig: "写入 daemon 配置",
    name: "名称",
    command: "命令",
    arguments: "参数",
    draftOnlyTitle: "本地配置草稿",
    draftOnlyHint: "可先录入一个真实 ACP command 组合，例如 `opencode acp --pure`，确认无误后再写入 daemon 配置。",
    daemonConfigTitle: "写入 daemon 配置",
    daemonConfigHint: "这里会向 `~/.tiller/config.json` 写入 provider 条目。建议先用 Test current ACP 验证命令可用。",
    hooksTitle: "ACP 归一化层",
    hooksBody: "runtime 会把 session/update 尽量归一化为消息、权限请求、命令输出与 diff 事件，便于不同 ACP 实现共用同一套 UI。",
    agentTestTitle: "Agent 测试",
    sessions: "会话",
    totalSuffix: "个",
    noSessions: "先创建一个会话开始控制环路。",
    sessionDetail: "会话详情",
    noActiveSession: "还没有活跃会话。",
    cancelSession: "取消会话",
    promptPlaceholder: "向当前会话发送提示词",
    sendPrompt: "发送提示词",
    agentStream: "Agent 消息流",
    commandOutput: "命令输出",
    diffSummary: "变更摘要",
    waitingForAgent: "等待 Agent 活动中。",
    permissionRequest: "权限请求",
    allowOnce: "本次允许",
    deny: "拒绝",
    noCommandOutput: "还没有命令输出。",
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
    writingConfig: "正在写入 provider 到 daemon 配置...",
    testRunningPrefix: "正在测试",
  },
  "en-US": {
    localeLabel: "English",
    localeSwitch: "中文",
    heroEyebrow: "ACP-first mobile control plane",
    heroBody: "A real control console for any ACP-compatible coding agent. Tiller now defaults to real ACP sessions with a thin protocol-normalization layer.",
    connection: {
      connecting: "connecting",
      connected: "connected",
      disconnected: "disconnected",
    },
    daemonAddress: "Daemon host",
    daemonPort: "Port",
    connectDaemon: "Connect daemon",
    reconnectDaemon: "Reconnect",
    connectHint: "Enter your daemon host and port first, then connect before pairing.",
    connectFeedbackIdle: "Daemon is not connected yet.",
    connectFeedbackConnecting: "Connecting to daemon...",
    pairingTitle: "Device pairing",
    pairingHint: "After connecting, enter the 6-character pairing code shown in the daemon terminal.",
    pairingFeedbackIdle: "Waiting for pairing code input.",
    pairingDebug: "Debug trace",
    controlPlane: "Control plane",
    testConfiguredAgent: "Test current ACP",
    createSession: "Create session",
    selectedWorkspace: "Workspace",
    selectedAgent: "Agent",
    workspaces: "Workspaces",
    agents: "ACP Agents",
    noWorkspaces: "No workspaces",
    noAgents: "No agents",
    addAgentDraft: "Add ACP Agent config",
    saveDraftLocal: "Save config draft locally",
    writeDaemonConfig: "Write to daemon config",
    name: "Name",
    command: "Command",
    arguments: "Arguments",
    draftOnlyTitle: "Local config draft",
    draftOnlyHint: "Start from a real ACP command such as `opencode acp --pure`, then write it into daemon config after validation.",
    daemonConfigTitle: "Daemon config write",
    daemonConfigHint: "This writes a provider entry into `~/.tiller/config.json`. Use Test current ACP first to verify the command works.",
    hooksTitle: "ACP normalization layer",
    hooksBody: "The runtime normalizes session/update traffic into messages, permission requests, command output, and diff events for a shared UI.",
    agentTestTitle: "Agent test",
    sessions: "Sessions",
    totalSuffix: "total",
    noSessions: "Create a session to start the control loop.",
    sessionDetail: "Session detail",
    noActiveSession: "No active session yet.",
    cancelSession: "Cancel session",
    promptPlaceholder: "Send a prompt to the current session",
    sendPrompt: "Send prompt",
    agentStream: "Agent stream",
    commandOutput: "Command output",
    diffSummary: "Diff summary",
    waitingForAgent: "Waiting for agent activity.",
    permissionRequest: "Permission request",
    allowOnce: "Allow once",
    deny: "Deny",
    noCommandOutput: "No command output yet.",
    noDiffSummary: "No changed files yet.",
    role: {
      assistant: "assistant",
      system: "system",
      user: "you",
    },
    status: {
      starting: "starting",
      running: "running",
      waiting_for_permission: "waiting",
      idle: "idle",
      error: "error",
      cancelled: "cancelled",
    },
    draftLoaded: "Loaded a config draft from browser storage.",
    draftParseFailed: "Failed to parse the saved config draft. Reverted to the default ACP command.",
    savedDraft: "Saved local config draft:",
    writingConfig: "Writing provider to daemon config...",
    testRunningPrefix: "Testing",
  },
} as const;

type AgentDraft = {
  name: string;
  command: string;
  args: string;
};

type WorkspaceDraft = {
  name: string;
  path: string;
};

type DaemonProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
};

type Locale = keyof typeof UI_COPY;
type UICopy = (typeof UI_COPY)[Locale];

type DebugTrace = {
  connectClicks: number;
  pairClicks: number;
  requestsSent: number;
  lastRequestType: string;
};

type AppView = "overview" | "sessions" | "agents" | "workspaces";

const VIEW_PATHS: Record<AppView, string> = {
  overview: "/",
  sessions: "/sessions",
  agents: "/agents",
  workspaces: "/workspaces",
};

export function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const requestCounter = useRef(0);
  const pairInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastPairingAttemptRef = useRef<string | null>(null);

  const [locale, setLocale] = useState<Locale>("zh-CN");
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
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [agents, setAgents] = useState<AcpAgentProvider[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [messages, setMessages] = useState<Record<string, AgentMessage[]>>({});
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest | null>>({});
  const [outputs, setOutputs] = useState<Record<string, CommandChunk[]>>({});
  const [diffs, setDiffs] = useState<Record<string, FileDiffSummary[]>>({});
  const [prompt, setPrompt] = useState("请审查当前登录流程，并提出最小且安全的重构方案。");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentTestResult, setAgentTestResult] = useState<string>("Not run yet.");
  const [resumeFeedback, setResumeFeedback] = useState<string>("");
  const [activeView, setActiveView] = useState<AppView>(() => resolveViewFromPath(window.location.pathname));
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({
    name: "OpenCode",
    command: "opencode",
    args: "acp --pure",
  });
  const [draftSaveMessage, setDraftSaveMessage] = useState<string>("Draft not saved yet.");
  const [configSaveMessage, setConfigSaveMessage] = useState<string>("Not written to daemon config yet.");
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft>({
    name: "",
    path: "",
  });
  const [workspaceSaveMessage, setWorkspaceSaveMessage] = useState<string>("");
  const [daemonProfiles, setDaemonProfiles] = useState<DaemonProfile[]>([]);
  const [daemonProfileName, setDaemonProfileName] = useState<string>("");
  const [daemonProfileMessage, setDaemonProfileMessage] = useState<string>("");

  const copy = UI_COPY[locale];

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const activeStatus = activeSession ? copy.status[statuses[activeSession.id] ?? activeSession.status] : copy.status.idle;
  const activeResumeLabel = formatResumeLabel(activeSession?.resume, locale);
  const activeResumeReason = activeSession?.resume?.reason ?? (locale === "zh-CN" ? "当前会话尚未返回 resume 元数据。" : "Resume metadata has not loaded yet.");
  const pendingPermission = activeSession ? permissionRequests[activeSession.id] ?? null : null;
  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const workspaceMatch = !selectedWorkspaceId || session.workspaceId === selectedWorkspaceId;
        const agentMatch = !selectedAgentId || session.agentId === selectedAgentId;
        return workspaceMatch && agentMatch;
      }),
    [selectedAgentId, selectedWorkspaceId, sessions],
  );
  const daemonInventory = daemonProfiles.map((profile) =>
    formatDaemonProfileLine(profile, daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT, connection, locale),
  );
  const viewLabels: Record<AppView, string> = {
    overview: locale === "zh-CN" ? "总览" : "Overview",
    sessions: locale === "zh-CN" ? "会话" : "Sessions",
    agents: locale === "zh-CN" ? "Agent 配置" : "Agents",
    workspaces: locale === "zh-CN" ? "工作区" : "Workspaces",
  };

  function navigateToView(view: AppView) {
    const nextPath = VIEW_PATHS[view];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setActiveView(view);
  }

  useEffect(() => {
    const savedDraft = window.localStorage.getItem(AGENT_DRAFT_STORAGE_KEY);
    const savedHost = window.localStorage.getItem(DAEMON_HOST_KEY);
    const savedPort = window.localStorage.getItem(DAEMON_PORT_KEY);
    const savedProfiles = readDaemonProfiles();
    if (savedHost) {
      setDaemonHost(savedHost);
    }
    if (savedPort) {
      setDaemonPort(savedPort);
    }
    setDaemonProfiles(savedProfiles);
    if (savedProfiles[0]) {
      setDaemonProfileName(savedProfiles[0].name);
    }
    if (savedDraft) {
      try {
        setAgentDraft(JSON.parse(savedDraft) as AgentDraft);
        setDraftSaveMessage(copy.draftLoaded);
      } catch {
        setDraftSaveMessage(copy.draftParseFailed);
      }
    }
    setConnectFeedback(copy.connectFeedbackIdle);
    setPairingFeedback(copy.pairingFeedbackIdle);
  }, [copy.draftLoaded, copy.draftParseFailed, copy.connectFeedbackIdle, copy.pairingFeedbackIdle]);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length) {
      setSelectedWorkspaceId(workspaces[0].id);
      setWorkspaceDraft((current) => ({
        ...current,
        path: current.path || workspaces[0]?.path || "",
      }));
    }
  }, [selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (!selectedAgentId && agents.length) {
      setSelectedAgentId(defaultAgentId(agents));
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    setResumeFeedback("");
  }, [activeSessionId]);

  useEffect(() => {
    if (pairingState === "input" && pairingCodeInput.length === 6) {
      sendPairingRequest();
    }
  }, [pairingCodeInput, pairingState]);

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
      setConnectFeedback(`Connected to ${wsUrl}`);
      const token = window.localStorage.getItem(daemonTokenStorageKey(host, port));
      if (token) {
        dispatch(socket, { type: "device.auth", requestId: nextRequestId(requestCounter), token });
        setPairingState("waiting");
        setPairingFeedback("Authenticating with saved token...");
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
      setConnectFeedback(`Failed to connect to ${wsUrl}`);
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
      case "workspace.list.result":
        setWorkspaces(payload.workspaces);
        return;
      case "workspace.save.result":
        setWorkspaceSaveMessage(payload.message);
        if (socketRef.current) {
          dispatch(socketRef.current, { type: "workspace.list", requestId: nextRequestId(requestCounter) });
        }
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
        }
        return;
      case "session.created":
        setSessions((current) => upsertSessionSummary(current, payload.session));
        setStatuses((current) => ({ ...current, [payload.session.id]: payload.session.status }));
        setActiveSessionId(payload.session.id);
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
                }
              : session,
          ),
        );
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

  function createSession() {
    const workspaceId = selectedWorkspaceId || workspaces[0]?.id;
    const agentId = selectedAgentId || agents[0]?.id;
    if (!workspaceId || !agentId || !socketRef.current) {
      return;
    }

    dispatch(socketRef.current, {
      type: "session.create",
      requestId: nextRequestId(requestCounter),
      workspaceId,
      agentId,
    });
    navigateToView("sessions");
  }

  function testAgent() {
    const agentId = selectedAgentId || agents[0]?.id;
    const agent = agents.find((item) => item.id === agentId);
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
        installHint: `Ensure \`${agentDraft.command} ${agentDraft.args}\` works in your terminal.`,
      },
    });
  }

  function saveWorkspaceDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!socketRef.current) {
      return;
    }

    const normalizedName = workspaceDraft.name.trim();
    const normalizedPath = workspaceDraft.path.trim().replace(/\\/g, "/");
    if (!normalizedName || !normalizedPath) {
      setWorkspaceSaveMessage(locale === "zh-CN" ? "请先填写 workspace 名称和路径。" : "Please provide both workspace name and path.");
      return;
    }

    const workspaceId = slugify(normalizedName);
    setWorkspaceSaveMessage(locale === "zh-CN" ? "正在写入 workspace 配置..." : "Writing workspace config...");
    dispatch(socketRef.current, {
      type: "workspace.save",
      requestId: nextRequestId(requestCounter),
      workspace: {
        id: workspaceId,
        name: normalizedName,
        path: normalizedPath,
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
    setDaemonProfileMessage(locale === "zh-CN" ? `已保存 daemon：${name}` : `Saved daemon profile: ${name}`);
    window.localStorage.setItem(DAEMON_PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
  }

  function applyDaemonProfile(profile: DaemonProfile) {
    setDaemonHost(profile.host);
    setDaemonPort(profile.port);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(locale === "zh-CN" ? `已切换到 ${profile.name}` : `Loaded profile ${profile.name}`);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || !activeSessionId || !socketRef.current) {
      return;
    }

    const nextPrompt = prompt.trim();
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
      setPairingFeedback(`Cannot send pairing request. socket=${socket ? socket.readyState : "null"}`);
      return;
    }

    setDebugTrace((current) => ({ ...current, pairClicks: current.pairClicks + 1 }));
    setPairingFeedback(`Sending pairing request for ${normalizedCode}...`);
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

  function startResume() {
    if (!activeSessionId || !socketRef.current) {
      return;
    }

    setResumeFeedback(locale === "zh-CN" ? "正在检查并尝试恢复当前 session..." : "Checking and attempting to resume the current session...");
    dispatch(socketRef.current, {
      type: "session.resume.start",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
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
              <strong>{locale === "zh-CN" ? "多 Daemon 预设" : "Daemon profiles"}</strong>
              <label>
                <span>{locale === "zh-CN" ? "预设名称" : "Profile name"}</span>
                <input value={daemonProfileName} onChange={(event) => setDaemonProfileName(event.target.value)} placeholder="Studio daemon" />
              </label>
              <div className="section-actions">
                <button className="secondary" type="button" onClick={saveDaemonProfile}>
                  {locale === "zh-CN" ? "保存当前 Daemon" : "Save current daemon"}
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
                <p className="muted compact">{locale === "zh-CN" ? "还没有保存的 daemon 预设。" : "No saved daemon profiles yet."}</p>
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
              {pairingState === "waiting" ? "Pairing..." : "Pair"}
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
            connectClicks={debugTrace.connectClicks} · pairClicks={debugTrace.pairClicks} · requestsSent={debugTrace.requestsSent}
          </p>
          <p className="muted compact">lastRequestType={debugTrace.lastRequestType}</p>
        </div>

        {pairingState === "rejected" && <p className="error-text">Pairing failed. Check the code and try again.</p>}
      </section>
    );
  }

  const showConnectionCard = connection !== "connected" && pairingState !== "paired";
  const showPairingCard = connection === "connected" && pairingState !== "paired";

  return (
    <main className="shell">
      <div className="app-shell">
            <aside className="sidebar card">
              <div className="sidebar-block brand-block">
                <p className="eyebrow">{copy.heroEyebrow}</p>
                <h1>Tiller</h1>
                <p className="muted">{copy.heroBody}</p>
              </div>

              <div className="sidebar-block status-stack">
                <div className={`status-pill status-${connection}`}>
                  <span className="dot" />
                  {copy.connection[connection]}
                </div>
                <button className="secondary sidebar-action" type="button" onClick={() => setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN"))}>
                  {copy.localeSwitch}
                </button>
              </div>

              <div className="sidebar-block sidebar-summary-grid">
                <StatCard label={copy.workspaces} value={String(workspaces.length)} meta={selectedWorkspaceId ? workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.name ?? copy.noWorkspaces : copy.noWorkspaces} />
                <StatCard label={copy.agents} value={String(agents.length)} meta={selectedAgentId ? agents.find((agent) => agent.id === selectedAgentId)?.name ?? copy.noAgents : copy.noAgents} />
                <StatCard label={copy.sessions} value={String(sessions.length)} meta={activeStatus} />
              </div>

              <div className="sidebar-block stack-gap">
                <div className="section-head sidebar-head">
                  <h2>{copy.controlPlane}</h2>
                  <span className="subtle">live</span>
                </div>
                <div className="sidebar-actions-grid">
                  <button className="secondary" type="button" onClick={testAgent} disabled={connection !== "connected" || !agents.length}>
                    {copy.testConfiguredAgent}
                  </button>
                  <button className="primary" type="button" onClick={createSession} disabled={connection !== "connected" || !agents.length || !workspaces.length}>
                    {copy.createSession}
                  </button>
                </div>
              </div>

              <div className="sidebar-block stack-gap">
                <div className="section-head sidebar-head">
                  <h2>{locale === "zh-CN" ? "菜单" : "Views"}</h2>
                  <span className="subtle">4</span>
                </div>
                <div className="view-nav">
                  {(Object.keys(viewLabels) as AppView[]).map((viewKey) => (
                    <button
                      key={viewKey}
                      type="button"
                      className={`view-nav-item ${activeView === viewKey ? "selected" : ""}`}
                      onClick={() => navigateToView(viewKey)}
                    >
                      {viewLabels[viewKey]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sidebar-block stack-gap">
                <div className="section-head sidebar-head">
                  <h2>{copy.sessions}</h2>
                  <span className="subtle">{sessions.length} {copy.totalSuffix}</span>
                </div>
                <SessionRecordList
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  resolveStatusLabel={(session) => copy.status[statuses[session.id] ?? session.status]}
                  resolveResumeLabel={(session) => formatResumeLabel(session.resume, locale)}
                  onSelect={setActiveSessionId}
                  emptyLabel={copy.noSessions}
                  formatTime={formatSessionTime}
                  compact
                />
              </div>
            </aside>

            <div className="workspace-view">
              <header className="hero card hero-panel">
                <div>
                  <p className="eyebrow">Digital Atelier</p>
                  <h2 className="hero-title">{viewLabels[activeView]}</h2>
                  <p className="muted hero-copy">{activeSession ? `${activeSession.agentName} · ${activeSession.workspaceName}` : copy.noActiveSession}</p>
                </div>
                <div className="hero-metrics">
                  <div className="hero-metric">
                    <span className="metric-label">Status</span>
                    <strong>{activeStatus}</strong>
                  </div>
                  <div className="hero-metric">
                    <span className="metric-label">Pending</span>
                    <strong>{pendingPermission ? "1" : "0"}</strong>
                  </div>
                </div>
              </header>

              {activeView === "overview" && (
                <section className="workspace-grid">
                  <div className="stack-gap">
                    <section className="card surface-card stack-gap">
                      <div className="section-head section-head-soft">
                        <div>
                          <h2>{copy.controlPlane}</h2>
                          <p className="muted compact">Bring your own ACP agent. Tiller handles the control plane.</p>
                        </div>
                      </div>

                      <div className="meta-grid">
                        <label>
                          <span>{copy.selectedWorkspace}</span>
                          <select value={selectedWorkspaceId ?? ""} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                            {workspaces.map((workspace) => (
                              <option key={workspace.id} value={workspace.id}>
                                {workspace.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>{copy.selectedAgent}</span>
                          <select value={selectedAgentId ?? ""} onChange={(event) => setSelectedAgentId(event.target.value)}>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="meta-grid">
                        <InfoList title={locale === "zh-CN" ? "当前状态" : "Current status"} items={[`Connection · ${copy.connection[connection]}`, `Session · ${activeStatus}`, `Resume · ${activeResumeLabel}`, `Pending permission · ${pendingPermission ? "1" : "0"}`]} empty={copy.noActiveSession} />
                        <InfoList title={locale === "zh-CN" ? "当前焦点" : "Current focus"} items={activeSession ? [`${activeSession.workspaceName}`, `${activeSession.agentName}`] : [copy.noActiveSession]} empty={copy.noActiveSession} />
                      </div>

                      <InfoList
                        title={locale === "zh-CN" ? "Daemon 聚合清单" : "Daemon inventory"}
                        items={daemonInventory}
                        empty={locale === "zh-CN" ? "还没有保存 daemon 预设。" : "No daemon profiles saved yet."}
                      />

                      {pairingState !== "paired" && (
                        <div className="note-box compact-note">
                          <strong>{locale === "zh-CN" ? "首页先行" : "Overview first"}</strong>
                          <p>{locale === "zh-CN" ? "现在可以先浏览首页与信息架构；需要连接 daemon 时，请前往 Agent 配置页。" : "You can browse the overview first. Connect or pair a daemon from the Agents view when needed."}</p>
                        </div>
                      )}
                    </section>

                    <section className="card surface-card stack-gap">
                      <div className="section-head section-head-soft">
                        <div>
                          <h2>{locale === "zh-CN" ? "运行概览" : "Run overview"}</h2>
                          <p className="muted compact">{locale === "zh-CN" ? "保留 ACP 控制闭环，同时把重要状态提纯成更清晰的概览层。" : "Keep the ACP loop intact while surfacing the key state in a cleaner overview layer."}</p>
                        </div>
                      </div>

                      <div className="meta-grid">
                        <InfoList title={locale === "zh-CN" ? "当前状态" : "Current status"} items={[`Connection · ${copy.connection[connection]}`, `Session · ${activeStatus}`, `Resume · ${activeResumeLabel}`, `Pending permission · ${pendingPermission ? "1" : "0"}`]} empty={copy.noActiveSession} />
                        <InfoList title={locale === "zh-CN" ? "当前焦点" : "Current focus"} items={activeSession ? [`${activeSession.workspaceName}`, `${activeSession.agentName}`] : [copy.noActiveSession]} empty={copy.noActiveSession} />
                      </div>
                    </section>
                  </div>

                  <section className="card surface-card stack-gap session-surface">
                    <div className="section-head section-head-soft">
                      <div>
                        <h2>{copy.sessionDetail}</h2>
                        <p className="muted compact">{activeSession ? `${activeSession.agentName} · ${activeSession.workspaceName}` : copy.noActiveSession}</p>
                      </div>
                      <div className="section-actions">
                        <button className="secondary" type="button" onClick={cancelSession} disabled={!activeSession}>
                          {copy.cancelSession}
                        </button>
                        <span className="status-chip">{activeStatus}</span>
                      </div>
                    </div>

                    {pendingPermission && (
                      <div className="permission-card">
                        <div>
                          <p className="eyebrow">{copy.permissionRequest}</p>
                          <h3>{pendingPermission.command}</h3>
                          <p className="muted compact">{pendingPermission.reason}</p>
                          <p className="subtle compact">{pendingPermission.workspacePath}</p>
                        </div>
                        <div className="permission-actions">
                          <button className="secondary" type="button" onClick={() => respondToPermission("deny")}>
                            {copy.deny}
                          </button>
                          <button className="primary" type="button" onClick={() => respondToPermission("allow")}>
                            {copy.allowOnce}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="note-box compact-note">
                      <strong>{locale === "zh-CN" ? "Runtime resume" : "Runtime resume"}</strong>
                      <p>{activeResumeLabel}</p>
                      <p className="muted compact">{activeSession ? activeResumeReason : copy.noActiveSession}</p>
                      {resumeFeedback ? <p className="subtle compact">{resumeFeedback}</p> : null}
                      <div className="section-actions">
                        <button className="secondary" type="button" onClick={startResume} disabled={!activeSession}>
                          {locale === "zh-CN" ? "尝试恢复" : "Attempt resume"}
                        </button>
                      </div>
                    </div>

                    <form className="prompt-form" onSubmit={submitPrompt}>
                      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={copy.promptPlaceholder} disabled={!activeSession} />
                      <button className="primary" type="submit" disabled={!activeSession || !prompt.trim()}>
                        {copy.sendPrompt}
                      </button>
                    </form>

                    <div className="detail-grid detail-grid-stacked">
                      <Panel title={copy.agentStream}>
                        <MessageStream items={activeSession ? messages[activeSession.id] ?? [] : []} copy={copy} />
                      </Panel>
                      <Panel title={copy.commandOutput} tone="terminal">
                        <CommandOutput items={activeSession ? outputs[activeSession.id] ?? [] : []} emptyLabel={copy.noCommandOutput} />
                      </Panel>
                      <Panel title={copy.diffSummary}>
                        <DiffSummary items={activeSession ? diffs[activeSession.id] ?? [] : []} emptyLabel={copy.noDiffSummary} />
                      </Panel>
                    </div>
                  </section>
                </section>
              )}

              {activeView === "agents" && (
                <section className="workspace-single">
                  {(showConnectionCard || showPairingCard) && renderConnectionPanel()}
                  <section className="card surface-card stack-gap">
                    <div className="section-head section-head-soft">
                      <div>
                        <h2>{copy.addAgentDraft}</h2>
                        <p className="muted compact">Use the new design language, but keep the ACP wiring minimal and editable.</p>
                      </div>
                      <div className="section-actions">
                        <button className="secondary" type="button" onClick={testAgent} disabled={connection !== "connected" || !agents.length}>
                          {copy.testConfiguredAgent}
                        </button>
                      </div>
                    </div>

                    <form className="config-form" onSubmit={saveDraft}>
                      <div className="section-head">
                        <h3>{copy.addAgentDraft}</h3>
                        <div className="section-actions">
                          <button className="secondary" type="submit">
                            {copy.saveDraftLocal}
                          </button>
                          <button className="primary" type="button" onClick={writeDraftToConfig} disabled={connection !== "connected" || !agentDraft.command.trim()}>
                            {copy.writeDaemonConfig}
                          </button>
                        </div>
                      </div>

                      <label>
                        <span>{copy.name}</span>
                        <input
                          value={agentDraft.name}
                          onChange={(event) => setAgentDraft((current) => ({ ...current, name: event.target.value }))}
                          placeholder="OpenCode"
                        />
                      </label>

                      <label>
                        <span>{copy.command}</span>
                        <input
                          value={agentDraft.command}
                          onChange={(event) => setAgentDraft((current) => ({ ...current, command: event.target.value }))}
                          placeholder="opencode"
                        />
                      </label>

                      <label>
                        <span>{copy.arguments}</span>
                        <input
                          value={agentDraft.args}
                          onChange={(event) => setAgentDraft((current) => ({ ...current, args: event.target.value }))}
                          placeholder="acp --pure"
                        />
                      </label>

                      <div className="meta-grid">
                        <InfoList title={copy.draftOnlyTitle} items={[copy.draftOnlyHint, draftSaveMessage]} empty={copy.draftOnlyHint} />
                        <InfoList title={copy.daemonConfigTitle} items={[copy.daemonConfigHint, configSaveMessage, `${copy.agentTestTitle}: ${agentTestResult}`]} empty={copy.daemonConfigHint} />
                      </div>
                    </form>
                  </section>
                </section>
              )}

              {activeView === "sessions" && (
                <section className="workspace-single">
                  <section className="card surface-card stack-gap session-surface">
                    <div className="section-head section-head-soft">
                      <div>
                        <h2>{copy.sessions}</h2>
                        <p className="muted compact">{activeSession ? `${activeSession.agentName} · ${activeSession.workspaceName}` : copy.noActiveSession}</p>
                      </div>
                      <div className="section-actions">
                        <button className="primary" type="button" onClick={createSession} disabled={connection !== "connected" || !agents.length || !workspaces.length}>
                          {copy.createSession}
                        </button>
                        <button className="secondary" type="button" onClick={cancelSession} disabled={!activeSession}>
                          {copy.cancelSession}
                        </button>
                      </div>
                    </div>

                    {pairingState !== "paired" ? (
                      <div className="note-box compact-note">
                        <strong>{locale === "zh-CN" ? "会话视图待连接" : "Sessions need a daemon connection"}</strong>
                        <p>{locale === "zh-CN" ? "请先去 Agent 配置页连接并配对 daemon，随后这里会展示多 daemon 下的 session 记录。" : "Connect and pair a daemon from the Agents view first. Session history will appear here afterward."}</p>
                      </div>
                    ) : (
                      <>
                        <div className="meta-grid">
                          <label>
                            <span>{copy.selectedWorkspace}</span>
                            <select value={selectedWorkspaceId ?? ""} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                              <option value="">{locale === "zh-CN" ? "全部工作区" : "All workspaces"}</option>
                              {workspaces.map((workspace) => (
                                <option key={workspace.id} value={workspace.id}>
                                  {workspace.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>{copy.selectedAgent}</span>
                            <select value={selectedAgentId ?? ""} onChange={(event) => setSelectedAgentId(event.target.value)}>
                              <option value="">{locale === "zh-CN" ? "全部 Agent" : "All agents"}</option>
                              {agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <SessionRecordList
                          sessions={filteredSessions}
                          activeSessionId={activeSessionId}
                          resolveStatusLabel={(session) => copy.status[statuses[session.id] ?? session.status]}
                          resolveResumeLabel={(session) => formatResumeLabel(session.resume, locale)}
                          onSelect={setActiveSessionId}
                          emptyLabel={locale === "zh-CN" ? "当前筛选条件下还没有会话记录。" : "No session records match the current filters."}
                          emptyPreviewLabel={locale === "zh-CN" ? "暂无消息预览" : "No preview yet"}
                          formatTime={formatSessionTime}
                        />

                        <div className="note-box compact-note">
                          <strong>{locale === "zh-CN" ? "Runtime resume" : "Runtime resume"}</strong>
                          <p>{activeResumeLabel}</p>
                          <p className="muted compact">{activeSession ? activeResumeReason : copy.noActiveSession}</p>
                          {resumeFeedback ? <p className="subtle compact">{resumeFeedback}</p> : null}
                          <div className="section-actions">
                            <button className="secondary" type="button" onClick={startResume} disabled={!activeSession}>
                              {locale === "zh-CN" ? "尝试恢复" : "Attempt resume"}
                            </button>
                          </div>
                        </div>

                        <form className="prompt-form" onSubmit={submitPrompt}>
                          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={copy.promptPlaceholder} disabled={!activeSession} />
                          <button className="primary" type="submit" disabled={!activeSession || !prompt.trim()}>
                            {copy.sendPrompt}
                          </button>
                        </form>

                        <div className="detail-grid detail-grid-stacked">
                          <Panel title={copy.agentStream}>
                            <MessageStream items={activeSession ? messages[activeSession.id] ?? [] : []} copy={copy} />
                          </Panel>
                          <Panel title={copy.commandOutput} tone="terminal">
                            <CommandOutput items={activeSession ? outputs[activeSession.id] ?? [] : []} emptyLabel={copy.noCommandOutput} />
                          </Panel>
                          <Panel title={copy.diffSummary}>
                            <DiffSummary items={activeSession ? diffs[activeSession.id] ?? [] : []} emptyLabel={copy.noDiffSummary} />
                          </Panel>
                        </div>
                      </>
                    )}
                  </section>
                </section>
              )}

              {activeView === "workspaces" && (
                <section className="workspace-single">
                  <section className="card surface-card stack-gap">
                    <div className="section-head section-head-soft">
                      <div>
                        <h2>{copy.workspaces}</h2>
                        <p className="muted compact">{locale === "zh-CN" ? "把工作区管理从会话细节里剥离出来，形成独立管理视图。" : "Pull workspace management out of session detail into its own management view."}</p>
                      </div>
                    </div>

                    {pairingState !== "paired" ? (
                      <div className="note-box compact-note">
                        <strong>{locale === "zh-CN" ? "工作区视图待连接" : "Workspaces need a daemon connection"}</strong>
                        <p>{locale === "zh-CN" ? "请先在 Agent 配置页连接 daemon，随后这里就能管理对应 daemon 的 workspace 清单。" : "Connect a daemon from the Agents view first. Then this page can manage that daemon's workspaces."}</p>
                      </div>
                    ) : (
                      <>
                        <div className="meta-grid">
                          <label>
                            <span>{copy.selectedWorkspace}</span>
                            <select value={selectedWorkspaceId ?? ""} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                              {workspaces.map((workspace) => (
                                <option key={workspace.id} value={workspace.id}>
                                  {workspace.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <InfoList title={locale === "zh-CN" ? "工作区清单" : "Workspace inventory"} items={workspaces.map((workspace) => `${workspace.name} · ${workspace.path}`)} empty={copy.noWorkspaces} />
                        </div>

                        <form className="config-form" onSubmit={saveWorkspaceDraft}>
                          <div className="section-head">
                            <h3>{locale === "zh-CN" ? "新增工作区" : "Add workspace"}</h3>
                            <div className="section-actions">
                              <button className="primary" type="submit" disabled={connection !== "connected"}>
                                {locale === "zh-CN" ? "写入 daemon 配置" : "Write to daemon config"}
                              </button>
                            </div>
                          </div>

                          <label>
                            <span>{locale === "zh-CN" ? "工作区名称" : "Workspace name"}</span>
                            <input
                              value={workspaceDraft.name}
                              onChange={(event) => setWorkspaceDraft((current) => ({ ...current, name: event.target.value }))}
                              placeholder={locale === "zh-CN" ? "例如：Tiller Core" : "Example: Tiller Core"}
                            />
                          </label>

                          <label>
                            <span>{locale === "zh-CN" ? "工作区路径" : "Workspace path"}</span>
                            <input
                              value={workspaceDraft.path}
                              onChange={(event) => setWorkspaceDraft((current) => ({ ...current, path: event.target.value }))}
                              placeholder="D:/projects/tiller-core"
                            />
                          </label>

                          <div className="note-box compact-note">
                            <strong>{locale === "zh-CN" ? "Workspace 写入状态" : "Workspace save status"}</strong>
                            <p>{workspaceSaveMessage || (locale === "zh-CN" ? "保存后会立即刷新 daemon 里的 workspace 列表。" : "The daemon workspace list will refresh immediately after save.")}</p>
                          </div>
                        </form>
                      </>
                    )}
                  </section>
                </section>
              )}
            </div>
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
    return locale === "zh-CN" ? "Resume 状态待检查" : "Resume status pending";
  }

  switch (resume.state) {
    case "resume-available":
      return locale === "zh-CN" ? "可恢复" : "Resume available";
    case "resume-unavailable":
      return locale === "zh-CN" ? "暂不可恢复" : "Resume unavailable";
    case "history-only":
    default:
      return locale === "zh-CN" ? "仅历史记录" : "History only";
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
  const status = isCurrent ? connection : locale === "zh-CN" ? "已保存" : "saved";
  return `${profile.name} · ${profile.host}:${profile.port} · ${status}`;
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

function defaultAgentId(agents: AcpAgentProvider[]) {
  return agents[0]?.id ?? null;
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
