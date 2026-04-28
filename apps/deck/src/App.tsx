import { Children, isValidElement, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import { resolveSessionConfigSupport } from "@tiller/shared";
import type {
  AcpAgentProvider,
  AcpModelOption,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionDecision,
  PermissionRequest,
  ProjectSummary,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionStatus,
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { shouldAttemptSilentReconnect, shouldEnsureLiveConnection } from "./hybrid-connection";
import { buildEnhancedPrompt, enhancePromptWithLlm, listPromptEnhancerModels, testPromptEnhancerConnectivity, type PromptEnhancerModelOption, type PromptEnhancerPreferences } from "./prompt-enhancer";
import { readDeckSnapshot, writeDeckSnapshot } from "./snapshot-cache";
import { createSessionStatusMap, pruneSessionScopedMap, resolveActiveSessionId, resolveDraftSelectionId, resolveModelOptionsFromConfig, resolvePromptPlaceholder } from "./session-state";
import { clearTrustedDeviceCache, getOrCreateDeviceId, readTrustedDeviceCache, writeTrustedDeviceCache, type TrustedDeviceCache } from "./trusted-device-cache";
import { buildConversationTimeline, commandChunkToToolCall, mergeToolCallHistory } from "./tool-timeline";
import { CommandOutput, DiffSummary, InfoList, PairingBoxes, StatCard } from "./ui";

const DEFAULT_DAEMON_HOST = "127.0.0.1";
const DEFAULT_DAEMON_PORT = "47631";
const AGENT_DRAFT_STORAGE_KEY = "tiller.agent-draft";
const DAEMON_HOST_KEY = "tiller.daemon-host";
const DAEMON_PORT_KEY = "tiller.daemon-port";
const DAEMON_PROFILE_STORAGE_KEY = "tiller.daemon-profiles";
const DECK_PREFERENCES_STORAGE_KEY = "tiller.deck-preferences";
const MISSION_PANEL_PAGES_STORAGE_KEY = "tiller.mission-panel-pages";
const DECK_DEVICE_NAME = "Tiller Deck";
const DEFAULT_PROMPT = "";
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
    heroBody: "一个 Command Deck，可连接多个 Helm，管理多个 ACP 舰员。先选项目，再进入该项目下的任务，会话成立后 ACP 舰员会被锁定。",
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
    testConfiguredAgent: "测试当前舰员",
    createSession: "创建任务",
    selectedWorkspace: "工作区",
    selectedAgent: "舰员",
    workspaces: "工作区",
    agents: "ACP 舰员",
    noWorkspaces: "暂无工作区",
    noAgents: "暂无舰员",
    addAgentDraft: "添加 ACP 舰员配置",
    saveDraftLocal: "保存本地配置草稿",
    writeDaemonConfig: "写入 Helm 配置",
    name: "名称",
    command: "命令",
    arguments: "参数",
    draftOnlyTitle: "本地配置草稿",
    draftOnlyHint: "可先录入一个真实 ACP 舰员 command 组合，例如 `opencode acp --pure`，确认无误后再写入 Helm 配置。",
    daemonConfigTitle: "写入 Helm 配置",
    daemonConfigHint: "这里会向 `~/.tiller/config.json` 写入舰员 provider 条目。建议先测试当前舰员命令可用。",
    hooksTitle: "ACP 归一化层",
    hooksBody: "runtime 会把 session/update 尽量归一化为消息、权限请求、航行日志与 diff 事件，便于不同 ACP 舰员共用同一套 UI。",
    agentTestTitle: "舰员测试",
    sessions: "任务",
    totalSuffix: "个",
    noSessions: "先创建一个任务开始控制环路。",
    sessionDetail: "任务详情",
    noActiveSession: "还没有活跃任务。",
    cancelSession: "取消任务",
    cleanupSession: "清理任务",
    promptPlaceholder: "向当前任务下达指令",
    sendPrompt: "发送提示词",
    agentStream: "舰员消息流",
    commandOutput: "航行日志",
    diffSummary: "变更摘要",
    waitingForAgent: "等待舰员活动中。",
    permissionRequest: "权限请求",
    allowOnce: "本次允许",
    deny: "拒绝",
    noCommandOutput: "航行日志暂无记录。",
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
    writingConfig: "正在写入舰员 provider 到 Helm 配置...",
    testRunningPrefix: "正在测试",
  },
} as const;

type AgentDraft = {
  name: string;
  command: string;
  args: string;
};

type DeckLanguage = "zh-CN" | "en-US";
type DeckTheme = "system" | "light" | "dark";

type TechnicalPanelPreferences = {
  logbookDefaultOpen: boolean;
  diffDefaultOpen: boolean;
  showSessionRuntimeMeta: boolean;
  showPermissionWorkspace: boolean;
  showOrderHints: boolean;
  showConnectionDebug: boolean;
};

type DeckPreferences = {
  language: DeckLanguage;
  theme: DeckTheme;
  reduceMotion: boolean;
  technicalPanels: TechnicalPanelPreferences;
  promptEnhancer: PromptEnhancerPreferences;
};

const DEFAULT_PROMPT_ENHANCER_INSTRUCTION = "你是 Tiller Deck 的协作型 Coding Agent。先理解目标、约束和风险，再给出可执行方案；涉及代码时遵循最小改动、可验证、可回滚。";
const DEFAULT_PROMPT_MODEL_PROFILE = "模型偏好：遵循当前任务的 模型 / 推理 配置；若上下文不足，先列出假设，不把模型选择写入 Helm 或后端配置。";
const DEFAULT_PROMPT_RESPONSE_CONTRACT = "输出契约：先给结论，再给步骤；涉及代码改动时包含验证方式、影响面与风险；需要用户决策时给 2-3 个选项。";
const OLD_PROMPT_LLM_SYSTEM_PROMPT = "你是提示词增强器。把用户草稿改写为清晰、可执行、可验证的 coding-agent 提示词；保留用户意图，不要直接回答任务。";
const DEFAULT_PROMPT_LLM_SYSTEM_PROMPT = `你是一个 coding-agent 提示词增强器。

你的任务是把用户的原始草稿改写成清晰、可执行、可验证的 Markdown 提示词，用于驱动代码代理完成开发任务。

你必须保留用户的真实意图，不要改变任务目标，不要擅自扩大范围，不要替用户做技术决策，除非用户草稿中已经明确表达。

你可以根据上下文补充必要的结构，例如目标、背景、约束、执行步骤、验收标准、验证方式、注意事项和交付要求，但只在有帮助时添加。

你应该让增强后的提示词具备以下特征：
- 面向 coding agent，而不是面向普通聊天助手
- 任务边界清楚
- 优先使用项目内已有代码、约定和上下文
- 鼓励先阅读相关文件再修改
- 鼓励小步修改，避免无关重构
- 鼓励给出可验证的完成标准
- 鼓励运行测试、类型检查、lint 或最小可行验证
- 对不确定信息提出需要确认的问题，而不是臆造
- 不暴露或重复无关的运行时、工具、会话细节

你不能直接回答用户草稿中的开发任务本身。
你只能输出增强后的 Prompt。
不要输出解释。
不要使用 Markdown 代码围栏。`;
const OLD_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = [
  "You are improving a user's draft into a clear coding-agent prompt.",
  "Project summary:",
  "{{projectSummary}}",
  "Session summary:",
  "{{sessionSummary}}",
  "User draft:",
  "{{userPrompt}}",
].join("\n");
const DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = `Rewrite the user's draft into a direct, repo-aware Markdown prompt for an autonomous coding agent.

Use the project/session context only to clarify the task. Preserve the user's intent exactly. Do not answer or implement the task yourself.

Inputs:
- Project summary: {{projectSummary}}
- Session summary: {{sessionSummary}}
- User draft: {{userPrompt}}

Output only the enhanced prompt, without Markdown code fences.

The enhanced prompt should:
- Be written as instructions to a coding agent working in the current repository.
- Make the task concrete, scoped, and verifiable.
- Encourage the agent to inspect the codebase before editing.
- Encourage the agent to follow existing conventions, naming, architecture, tests, and style.
- Prefer minimal, targeted changes over broad rewrites.
- Separate facts from assumptions.
- Include goals, constraints, acceptance criteria, and verification steps when useful.
- Ask clarifying questions only when the task cannot be safely executed without them.
- Avoid invented details, fake file paths, fake APIs, or unsupported assumptions.
- Avoid irrelevant runtime/tool/session details.
- Avoid explaining that the prompt was enhanced.

Use this structure when applicable:

# Objective

State the user?s intended outcome clearly.

# Relevant Context

Include only context that helps the coding agent complete the task.

# Goals

List the expected outcomes.

# Scope

Define what is included and what is out of scope.

# Constraints

List important limits, compatibility requirements, user preferences, or things the agent must avoid.

# Instructions

Give direct execution guidance:
1. Inspect the relevant parts of the repository before making changes.
2. Identify existing patterns, APIs, tests, and conventions related to the task.
3. Make the smallest safe change that satisfies the objective.
4. Avoid unrelated refactors, formatting churn, dependency changes, or behavior changes.
5. Update or add tests only where they directly verify the requested behavior.
6. Keep user-facing behavior, compatibility, and existing contracts intact unless the user explicitly requested otherwise.

# Acceptance Criteria

List measurable conditions that indicate the task is complete.

# Verification

List concrete checks the agent should run or explain if unavailable.

# Questions / Assumptions

Include this section only if the draft is ambiguous or missing critical information.
State assumptions explicitly and keep them minimal.

Return only the final enhanced Markdown prompt.`;

const DEFAULT_DECK_PREFERENCES: DeckPreferences = {
  language: "zh-CN",
  theme: "system",
  reduceMotion: false,
  technicalPanels: {
    logbookDefaultOpen: false,
    diffDefaultOpen: false,
    showSessionRuntimeMeta: true,
    showPermissionWorkspace: true,
    showOrderHints: true,
    showConnectionDebug: false,
  },
  promptEnhancer: {
    enabled: true,
    instruction: DEFAULT_PROMPT_ENHANCER_INSTRUCTION,
    modelProfile: DEFAULT_PROMPT_MODEL_PROFILE,
    responseContract: DEFAULT_PROMPT_RESPONSE_CONTRACT,
    llm: {
      enabled: true,
      baseUrl: "",
      apiKey: "",
      model: "",
      systemPrompt: DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
      instructionTemplate: DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
    },
  },
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

type MissionPanelPage = {
  id: string;
  title: string;
};

type CleanupFeedback = {
  tone: "success" | "warning" | "info";
  message: string;
};

type MissionPaneWidths = {
  sidebar: number;
  display: number;
  inspector: number;
};

type MissionResizeHandle = "sidebar" | "display" | "inspector";

const DEFAULT_MISSION_PANE_WIDTHS: MissionPaneWidths = { sidebar: 320, display: 520, inspector: 320 };
const MISSION_PANE_LIMITS: Record<keyof MissionPaneWidths, { min: number; max: number }> = {
  sidebar: { min: 260, max: 420 },
  display: { min: 300, max: 720 },
  inspector: { min: 260, max: 420 },
};

function clampPaneWidth(value: number, pane: keyof MissionPaneWidths) {
  const limits = MISSION_PANE_LIMITS[pane];
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

type AppView = "overview" | "sessions" | "agents" | "settings";

const VIEW_PATHS: Record<AppView, string> = {
  overview: "/",
  sessions: "/mission",
  agents: "/agents",
  settings: "/settings",
};

const NAV_LABELS: Record<DeckLanguage, Record<AppView, string>> = {
  "zh-CN": {
    overview: "总览",
    sessions: "任务",
    agents: "舰队",
    settings: "设置",
  },
  "en-US": {
    overview: "总览",
    sessions: "任务",
    agents: "舰队",
    settings: "设置",
  },
};

function TopNav({
  activeView,
  onNavigate,
  connection,
  language,
}: {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  connection: "connecting" | "connected" | "disconnected";
  language: DeckLanguage;
}) {
  const labels = NAV_LABELS[language];
  const items: { id: AppView; label: string }[] = [
    { id: "overview", label: labels.overview },
    { id: "sessions", label: labels.sessions },
    { id: "agents", label: labels.agents },
    { id: "settings", label: labels.settings },
  ];

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
      <button className={`admiral-avatar admiral-${connection}`} type="button" aria-label="党徽状态标识">
        <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
          <defs>
            <radialGradient id="emblem-black" cx="28" cy="22" r="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#151515" />
              <stop offset="1" stopColor="#000000" />
            </radialGradient>
            <linearGradient id="emblem-gold" x1="12" x2="52" y1="8" y2="58" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fde68a" />
              <stop offset="0.34" stopColor="#facc15" />
              <stop offset="1" stopColor="#d97706" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="30" fill="url(#emblem-black)" />
          <text
            x="31.4"
            y="56"
            fill="url(#emblem-gold)"
            fontFamily="'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Arial Unicode MS', sans-serif"
            fontSize="57"
            fontWeight="900"
            textAnchor="middle"
          >☭</text>
          <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(250, 204, 21, 0.44)" strokeWidth="1.4" />
        </svg>
      </button>
    </header>
  );
}


const markdownComponents: Components = {
  a({ children, href, ...props }) {
    const external = Boolean(href && /^(https?:)?\/\//i.test(href));
    return <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{children}</a>;
  },
  img() {
    return null;
  },
  pre({ children }) {
    const code = extractTextFromReactNode(children).replace(/\n$/, "");
    const language = findCodeLanguage(children);
    return <MarkdownCodeBlock code={code} language={language}>{children}</MarkdownCodeBlock>;
  },
};

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="markdown-message">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCodeBlock({ children, code, language }: { children: ReactNode; code: string; language?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [highlightedCode, setHighlightedCode] = useState<{ html: string; language?: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    setHighlightedCode(null);

    if (!code.trim()) {
      return () => {
        mounted = false;
      };
    }

    void import("highlight.js/lib/common")
      .then((module) => {
        const hljs = module.default;
        const result = language && hljs.getLanguage(language)
          ? hljs.highlight(code, { language, ignoreIllegals: true })
          : hljs.highlightAuto(code);
        if (mounted) {
          setHighlightedCode({ html: result.value, language: result.language ?? language });
        }
      })
      .catch(() => {
        if (mounted) {
          setHighlightedCode(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [code, language]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{highlightedCode?.language ?? language ?? "text"}</span>
        <button type="button" onClick={copyCode} disabled={!code} aria-label="复制代码块">{copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}</button>
      </div>
      {highlightedCode ? (
        <pre><code className={`hljs language-${highlightedCode.language ?? language ?? "text"}`} dangerouslySetInnerHTML={{ __html: highlightedCode.html }} /></pre>
      ) : (
        <pre>{children}</pre>
      )}
    </div>
  );
}

function extractTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromReactNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractTextFromReactNode(node.props.children);
  return "";
}

function findCodeLanguage(node: ReactNode): string | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) continue;
    const match = /language-([\w-]+)/.exec(child.props.className ?? "");
    if (match?.[1]) return match[1];
    const nested = findCodeLanguage(child.props.children);
    if (nested) return nested;
  }
  return undefined;
}


type MissionVisualFixture = {
  helms: HelmSummary[];
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  statuses: Record<string, SessionStatus>;
  messages: Record<string, AgentMessage[]>;
  outputs: Record<string, CommandChunk[]>;
  toolCalls: Record<string, AgentToolCall[]>;
  diffs: Record<string, FileDiffSummary[]>;
  activeSessionId: string;
  selectedProjectId: string;
  selectedWorkspaceId: string;
  selectedAgentId: string;
};

function shouldUseMissionVisualFixture() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("visual") === "mission";
}

function createMissionVisualFixture(): MissionVisualFixture {
  const now = new Date().toISOString();
  const helmId = "visual-helm";
  const projectId = "visual-project";
  const workspaceId = "visual-workspace";
  const agentId = "visual-codex";
  const sessionId = "visual-session";
  const session: SessionSummary = {
    id: sessionId,
    projectId,
    projectName: "Tiller",
    helmId,
    workspaceId,
    workspaceName: "Tiller",
    agentId,
    agentName: "Codex",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    status: "running",
    createdAt: now,
    updatedAt: now,
    messageCount: 4,
    runtimeSessionId: "visual-acp-session",
    lastMessagePreview: "按 Zed 风格微调 任务页布局。",
  };

  return {
    helms: [{ id: helmId, name: "Local Helm", host: DEFAULT_DAEMON_HOST, port: Number(DEFAULT_DAEMON_PORT) }],
    workspaces: [{ id: workspaceId, name: "Tiller", path: "D:/myProject/tools/Tiller" }],
    projects: [{ id: projectId, name: "Tiller", helmId, workspaceIds: [workspaceId], allowedAgentIds: [agentId], defaultWorkspaceId: workspaceId, defaultAgentId: agentId }],
    agents: [{ id: agentId, name: "Codex", command: "codex-acp", args: ["-c", "model=gpt-5.5"], transport: "stdio", protocol: "acp" }],
    sessions: [session],
    statuses: { [sessionId]: "running" },
    activeSessionId: sessionId,
    selectedProjectId: projectId,
    selectedWorkspaceId: workspaceId,
    selectedAgentId: agentId,
    messages: {
      [sessionId]: [
        { id: "visual-user-1", role: "user", text: `# ??????

?? Zed ? Agent Panel ???? ????`, timestamp: now },
        { id: "visual-assistant-1", role: "assistant", text: `## ??/??

?? ?????? Zed-like ?????

- ????? / ?? rail
- ????????
- ???sticky composer
- ?????? inspector`, timestamp: now },
      ],
    },
    outputs: {
      [sessionId]: [
        { id: "visual-output-1", commandId: "visual-command-1", text: `pnpm --filter @tiller/deck build
? built in 2.0s`, stream: "stdout", timestamp: now },
      ],
    },
    toolCalls: {
      [sessionId]: [
        { id: "visual-tool-1", kind: "terminal", title: "pnpm --filter @tiller/deck build", status: "completed", commandId: "visual-command-1", output: "✓ built in 2.0s", stream: "stdout", timestamp: now, updatedAt: now },
      ],
    },
    diffs: {
      [sessionId]: [
        { path: "apps/deck/src/App.tsx", status: "modified", additions: 44, deletions: 18 },
        { path: "apps/deck/src/styles.css", status: "modified", additions: 134, deletions: 0 },
      ],
    },
  };
}

export function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const helmSocketRefs = useRef<Map<string, WebSocket>>(new Map());
  const requestCounter = useRef(0);
  const pairInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastPairingAttemptRef = useRef<string | null>(null);
  const pendingPromptRef = useRef<{ raw: string; enhanced: string } | null>(null);
  const promptModelPickerRef = useRef<HTMLDivElement | null>(null);
  const initialPreferences = useMemo(() => readDeckPreferences(), []);
  const missionVisualMode = useMemo(() => shouldUseMissionVisualFixture(), []);
  const missionVisualFixture = useMemo(() => missionVisualMode ? createMissionVisualFixture() : null, [missionVisualMode]);
  const deckDeviceId = useMemo(() => getOrCreateDeviceId(window.localStorage), []);
  const autoConnectAttemptRef = useRef<string | null>(null);

  const locale: Locale = "zh-CN";
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">(missionVisualFixture ? "connected" : "disconnected");
  const [helmConnectionStates, setHelmConnectionStates] = useState<Record<string, "connecting" | "connected" | "disconnected">>({});
  const [pairingState, setPairingState] = useState<"idle" | "waiting" | "input" | "paired" | "rejected">(missionVisualFixture ? "paired" : "idle");
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  const [pairingFeedback, setPairingFeedback] = useState("");
  const [connectFeedback, setConnectFeedback] = useState("");
  const [daemonHost, setDaemonHost] = useState(() => window.localStorage.getItem(DAEMON_HOST_KEY) ?? DEFAULT_DAEMON_HOST);
  const [daemonPort, setDaemonPort] = useState(() => window.localStorage.getItem(DAEMON_PORT_KEY) ?? DEFAULT_DAEMON_PORT);
  const [debugTrace, setDebugTrace] = useState<DebugTrace>({
    connectClicks: 0,
    pairClicks: 0,
    requestsSent: 0,
    lastRequestType: "none",
  });
  const [helms, setHelms] = useState<HelmSummary[]>(missionVisualFixture?.helms ?? []);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(missionVisualFixture?.workspaces ?? []);
  const [projects, setProjects] = useState<ProjectSummary[]>(missionVisualFixture?.projects ?? []);
  const [agents, setAgents] = useState<AcpAgentProvider[]>(missionVisualFixture?.agents ?? []);
  const [sessions, setSessions] = useState<SessionSummary[]>(missionVisualFixture?.sessions ?? []);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>(missionVisualFixture?.statuses ?? {});
  const [messages, setMessages] = useState<Record<string, AgentMessage[]>>(missionVisualFixture?.messages ?? {});
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest | null>>({});
  const [outputs, setOutputs] = useState<Record<string, CommandChunk[]>>(missionVisualFixture?.outputs ?? {});
  const [toolCalls, setToolCalls] = useState<Record<string, AgentToolCall[]>>(missionVisualFixture?.toolCalls ?? {});
  const [diffs, setDiffs] = useState<Record<string, FileDiffSummary[]>>(missionVisualFixture?.diffs ?? {});
  const [sessionConfigOptions, setSessionConfigOptions] = useState<Record<string, SessionConfigOption[]>>({});
  const [deckPreferences, setDeckPreferences] = useState<DeckPreferences>(initialPreferences);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [promptEnhancerStatus, setPromptEnhancerStatus] = useState("");
  const [promptEnhancerModels, setPromptEnhancerModels] = useState<PromptEnhancerModelOption[]>([]);
  const [promptEnhancerModelFilter, setPromptEnhancerModelFilter] = useState("");
  const [promptEnhancerModelPickerOpen, setPromptEnhancerModelPickerOpen] = useState(false);
  const [promptEnhancerBusy, setPromptEnhancerBusy] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(missionVisualFixture?.activeSessionId ?? null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(missionVisualFixture?.selectedProjectId ?? null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(missionVisualFixture?.selectedWorkspaceId ?? null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(missionVisualFixture?.selectedAgentId ?? null);
  const [selectedModel, setSelectedModel] = useState<string>(missionVisualFixture?.sessions[0]?.model ?? MODEL_OPTIONS[0]);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<SessionReasoningEffort>("medium");
  const [agentTestResult, setAgentTestResult] = useState<string>("尚未测试");
  const [resumeFeedback, setResumeFeedback] = useState<string>("");
  const [cleanupFeedback, setCleanupFeedback] = useState<CleanupFeedback | null>(null);
  const [customMissionPanelPages, setCustomMissionPanelPages] = useState<MissionPanelPage[]>(() => readMissionPanelPages());
  const [selectedMissionPanelPageId, setSelectedMissionPanelPageId] = useState("overview");
  const [draggedMissionPanelPageId, setDraggedMissionPanelPageId] = useState<string | null>(null);
  const [missionPaneWidths, setMissionPaneWidths] = useState<MissionPaneWidths>(DEFAULT_MISSION_PANE_WIDTHS);
  const [activeView, setActiveView] = useState<AppView>(() => resolveViewFromPath(window.location.pathname));
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({
    name: "OpenCode",
    command: "opencode",
    args: "acp --pure",
  });
  const [draftSaveMessage, setDraftSaveMessage] = useState<string>("草稿未保存");
  const [configSaveMessage, setConfigSaveMessage] = useState<string>("尚未写入 Helm 配置");
  const [daemonProfiles, setDaemonProfiles] = useState<DaemonProfile[]>(() => readDaemonProfiles());
  const [selectedHelmKey, setSelectedHelmKey] = useState<string>("");
  const [agentConfigExpanded, setAgentConfigExpanded] = useState(false);
  const [fleetAddHelmModalOpen, setFleetAddHelmModalOpen] = useState(false);
  const [fleetAddHelmStage, setFleetAddHelmStage] = useState<"connect" | "connecting" | "pair">("connect");
  const [daemonProfileName, setDaemonProfileName] = useState<string>("");
  const [daemonProfileMessage, setDaemonProfileMessage] = useState<string>("");
  const [trustedDevice, setTrustedDevice] = useState<TrustedDeviceCache | null>(() =>
    readTrustedDeviceCache(
      window.localStorage,
      window.localStorage.getItem(DAEMON_HOST_KEY) ?? DEFAULT_DAEMON_HOST,
      window.localStorage.getItem(DAEMON_PORT_KEY) ?? DEFAULT_DAEMON_PORT,
    ),
  );
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceSummary[]>([]);

  const copy = UI_COPY[locale];

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
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
    () => sessions.filter((session) => !selectedProjectId || session.projectId === selectedProjectId),
    [selectedProjectId, sessions],
  );
  const sessionCountsByProject = useMemo(
    () => sessions.reduce<Record<string, number>>((counts, session) => ({ ...counts, [session.projectId]: (counts[session.projectId] ?? 0) + 1 }), {}),
    [sessions],
  );
  const activeStatus = activeSession ? copy.status[statuses[activeSession.id] ?? activeSession.status] : copy.status.idle;
  const activeResumeLabel = formatResumeLabel(activeSession?.resume, locale);
  const pendingPermission = activeSession ? permissionRequests[activeSession.id] ?? null : null;
  const draftAgent = agents.find((agent) => agent.id === (activeSession?.agentId ?? selectedAgentId)) ?? null;
  const draftModel = activeSession ? activeSession.model ?? MODEL_OPTIONS[0] : selectedModel;
  const draftReasoningEffort = activeSession ? activeSession.reasoningEffort ?? "medium" : selectedReasoningEffort;
  const draftPromptPlaceholder = resolvePromptPlaceholder(draftAgent);
  const draftConfigHint = resolveSessionConfigHint(activeSession, agents, activeSession?.agentId ?? selectedAgentId);
  const draftModelPlaceholder = resolveModelInputPlaceholder(activeSession, agents, activeSession?.agentId ?? selectedAgentId);
  const draftConfigOptions = resolveDraftConfigOptions(activeSession, sessions, sessionConfigOptions, selectedAgentId);
  const draftModelOptions = resolveModelOptions(draftModel, draftConfigOptions);
  const daemonInventory = daemonProfiles.map((profile) =>
    formatDaemonProfileLine(profile, daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT, connection, locale),
  );
  const activeProfileId = `${daemonHost.trim() || DEFAULT_DAEMON_HOST}:${daemonPort.trim() || DEFAULT_DAEMON_PORT}`;
  const viewLabels = NAV_LABELS[deckPreferences.language];

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
      if (current && sessions.some((session) => session.id === current && session.projectId === projectId)) {
        return current;
      }
      return sessions.find((session) => session.projectId === projectId)?.id ?? null;
    });
  }

  function openSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
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
    const nextWorkspaceId = resolveDraftSelectionId(selectedWorkspaceId, filteredWorkspaces, defaultWorkspaceId);
    if (nextWorkspaceId && nextWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceId(nextWorkspaceId);
    }
  }, [draftProject, filteredWorkspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (!draftProject) {
      return;
    }
    const defaultProjectAgentId = draftProject.defaultAgentId;
    const fallbackAgentId = resolveDraftSelectionId(selectedAgentId, filteredAgents, defaultProjectAgentId ?? defaultAgentId(filteredAgents));
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

  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/g, "") === "/sessions") {
      window.history.replaceState({}, "", VIEW_PATHS.sessions);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DECK_PREFERENCES_STORAGE_KEY, JSON.stringify(deckPreferences));
    document.documentElement.dataset.deckTheme = deckPreferences.theme;
    document.documentElement.dataset.deckReduceMotion = String(deckPreferences.reduceMotion);
  }, [deckPreferences]);

  useEffect(() => {
    if (!promptEnhancerModelPickerOpen) {
      return;
    }

    function closePromptModelPicker(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && promptModelPickerRef.current?.contains(target)) {
        return;
      }
      setPromptEnhancerModelPickerOpen(false);
    }

    function closePromptModelPickerWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPromptEnhancerModelPickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", closePromptModelPicker);
    document.addEventListener("keydown", closePromptModelPickerWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePromptModelPicker);
      document.removeEventListener("keydown", closePromptModelPickerWithKeyboard);
    };
  }, [promptEnhancerModelPickerOpen]);

  useEffect(() => {
    if (fleetAddHelmModalOpen && fleetAddHelmStage === "connecting" && connection === "connected") {
      setFleetAddHelmStage("pair");
    }
  }, [connection, fleetAddHelmModalOpen, fleetAddHelmStage]);

  function openFleetAddHelmModal() {
    setFleetAddHelmStage("connect");
    setFleetAddHelmModalOpen(true);
  }

  function closeFleetAddHelmModal() {
    setFleetAddHelmModalOpen(false);
    setFleetAddHelmStage("connect");
  }

  function connectFromFleetAddHelmModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveDaemonProfile();
    setFleetAddHelmStage("connecting");
    void connectToDaemon(undefined, { preserveState: true });
  }

  useEffect(() => {
    window.localStorage.setItem(MISSION_PANEL_PAGES_STORAGE_KEY, JSON.stringify(customMissionPanelPages));
  }, [customMissionPanelPages]);

  useEffect(() => {
    setTrustedDevice(readTrustedDeviceCache(window.localStorage, daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT));
    setTrustedDevices([]);
  }, [daemonHost, daemonPort]);

  useEffect(() => {
    if (missionVisualMode) {
      return;
    }
    const snapshot = readDeckSnapshot(window.localStorage, activeProfileId);
    if (!snapshot) {
      return;
    }
    setProjects(snapshot.projects);
    setSessions(snapshot.sessions);
    setWorkspaces(snapshot.workspaces);
    setAgents(snapshot.agents);
    setStatuses(createSessionStatusMap(snapshot.sessions));
    setSelectedProjectId((current) => current ?? snapshot.projects[0]?.id ?? null);
  }, [activeProfileId, missionVisualMode]);

  useEffect(() => {
    if (missionVisualMode || pairingState !== "paired") {
      return;
    }
    writeDeckSnapshot(window.localStorage, {
      profileId: activeProfileId,
      cachedAt: new Date().toISOString(),
      projects,
      sessions,
      workspaces,
      agents,
    });
  }, [activeProfileId, agents, pairingState, projects, sessions, workspaces]);

  useEffect(() => {
    if (missionVisualMode || !trustedDevice?.token) {
      return;
    }
    if (!shouldAttemptSilentReconnect({
      connection,
      tokenPresent: true,
      host: daemonHost,
      port: daemonPort,
    })) {
      return;
    }
    const attemptKey = `silent:${activeProfileId}`;
    if (autoConnectAttemptRef.current === attemptKey) {
      return;
    }
    autoConnectAttemptRef.current = attemptKey;
    connectToDaemon(undefined, { preserveState: true, auto: true });
  }, [activeProfileId, connection, daemonHost, daemonPort, missionVisualMode, trustedDevice?.token]);

  useEffect(() => {
    if (missionVisualMode || !trustedDevice?.token || !shouldEnsureLiveConnection(activeView) || connection !== "disconnected") {
      return;
    }
    const attemptKey = `live:${activeView}:${activeProfileId}`;
    if (autoConnectAttemptRef.current === attemptKey) {
      return;
    }
    autoConnectAttemptRef.current = attemptKey;
    connectToDaemon(undefined, { preserveState: true, auto: true });
  }, [activeProfileId, activeView, connection, missionVisualMode, trustedDevice?.token]);

  function updateDeckPreference<K extends keyof DeckPreferences>(key: K, value: DeckPreferences[K]) {
    setDeckPreferences((current) => ({ ...current, [key]: value }));
  }

  function updateTechnicalPanelPreference<K extends keyof TechnicalPanelPreferences>(key: K, value: TechnicalPanelPreferences[K]) {
    setDeckPreferences((current) => ({
      ...current,
      technicalPanels: { ...current.technicalPanels, [key]: value },
    }));
  }

  function updatePromptEnhancerPreference<K extends keyof PromptEnhancerPreferences>(key: K, value: PromptEnhancerPreferences[K]) {
    setDeckPreferences((current) => ({
      ...current,
      promptEnhancer: { ...current.promptEnhancer, [key]: value },
    }));
  }

  function updatePromptEnhancerLlmPreference<K extends keyof PromptEnhancerPreferences["llm"]>(key: K, value: PromptEnhancerPreferences["llm"][K]) {
    setDeckPreferences((current) => ({
      ...current,
      promptEnhancer: {
        ...current.promptEnhancer,
        llm: { ...current.promptEnhancer.llm, [key]: value },
      },
    }));
  }

  function resetPromptEnhancerDefaults() {
    setDeckPreferences((current) => ({
      ...current,
      promptEnhancer: {
        ...current.promptEnhancer,
        llm: {
          ...current.promptEnhancer.llm,
          systemPrompt: DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
          instructionTemplate: DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
        },
      },
    }));
    setPromptEnhancerStatus("已恢复默认增强器 System Prompt 与指令模板。");
  }

  async function testPromptEnhancerSelectedModel() {
    setPromptEnhancerBusy(true);
    setPromptEnhancerStatus("正在测试 LLM 连通性...");
    try {
      await testPromptEnhancerConnectivity(deckPreferences.promptEnhancer.llm);
      setPromptEnhancerStatus("LLM 连通性正常。");
    } catch (error) {
      setPromptEnhancerStatus(error instanceof Error ? error.message : "LLM 连通性测试失败");
    } finally {
      setPromptEnhancerBusy(false);
    }
  }

  async function refreshPromptEnhancerModels() {
    setPromptEnhancerBusy(true);
    setPromptEnhancerModelPickerOpen(true);
    setPromptEnhancerStatus("正在获取模型列表...");
    try {
      const models = await listPromptEnhancerModels(deckPreferences.promptEnhancer.llm);
      setPromptEnhancerModels(models);
      const ownerCount = new Set(models.map((model) => model.ownedBy)).size;
      setPromptEnhancerStatus(models.length ? `已获取 ${models.length} 个模型，来自 ${ownerCount} 个 owner。` : "模型接口可用，但没有返回模型。");
    } catch (error) {
      setPromptEnhancerStatus(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setPromptEnhancerBusy(false);
    }
  }

  function updatePromptEnhancerModelInput(value: string) {
    updatePromptEnhancerLlmPreference("model", value);
    setPromptEnhancerModelFilter(value);
    setPromptEnhancerModelPickerOpen(true);
  }

  function selectPromptEnhancerModel(model: PromptEnhancerModelOption) {
    updatePromptEnhancerLlmPreference("model", model.id);
    setPromptEnhancerModelFilter("");
    setPromptEnhancerModelPickerOpen(false);
    setPromptEnhancerStatus(`已选择 ${model.id}（${model.ownedBy}）。`);
  }

  async function enhancePromptDraft() {
    const rawPrompt = prompt.trim();
    if (!rawPrompt) {
      return;
    }
    setPromptEnhancerBusy(true);
    setPromptEnhancerStatus("正在增强提示词...");
    try {
      const workspace = filteredWorkspaces.find((item) => item.id === (activeSession?.workspaceId ?? selectedWorkspaceId));
      const enhanced = await enhancePromptWithLlm(rawPrompt, deckPreferences.promptEnhancer, {
        projectName: draftProject?.name ?? activeSession?.projectName,
        workspaceName: activeSession?.workspaceName ?? workspace?.name,
        projectSummary: draftProject?.summary,
        workspaceSummary: workspace?.summary,
        sessionStatus: activeSession?.status,
        sessionSummary: summarizeSessionContext(activeSession, activeSession ? messages[activeSession.id] ?? [] : []),
      });
      setPrompt(enhanced);
      setPromptEnhancerStatus("已增强并回填输入框，请确认后再发送。");
    } catch (error) {
      setPromptEnhancerStatus(error instanceof Error ? error.message : "提示词增强失败");
    } finally {
      setPromptEnhancerBusy(false);
    }
  }

  function resetDeckPreferences() {
    setDeckPreferences(DEFAULT_DECK_PREFERENCES);
  }

  function requestInitialSync(socket: WebSocket) {
    dispatch(socket, { type: "helm.list", requestId: nextRequestId(requestCounter) });
    dispatch(socket, { type: "project.list", requestId: nextRequestId(requestCounter) });
    dispatch(socket, { type: "workspace.list", requestId: nextRequestId(requestCounter) });
    dispatch(socket, { type: "agent.list", requestId: nextRequestId(requestCounter) });
    dispatch(socket, { type: "session.list", requestId: nextRequestId(requestCounter) });
    dispatch(socket, { type: "device.list", requestId: nextRequestId(requestCounter) });
  }

  function setHelmConnectionState(helmKey: string, state: "connecting" | "connected" | "disconnected") {
    setHelmConnectionStates((current) => ({ ...current, [helmKey]: state }));
  }

  function connectHelmSocket(profile: DaemonProfile) {
    const helmKey = daemonProfileKey(profile.host, profile.port);
    const existing = helmSocketRefs.current.get(helmKey);
    if (existing?.readyState === WebSocket.OPEN) {
      setHelmConnectionState(helmKey, "connected");
      setDaemonProfileMessage(`${profile.name} 已连接`);
      return;
    }
    existing?.close();

    const wsUrl = `ws://${profile.host}:${profile.port}`;
    const socket = new WebSocket(wsUrl);
    helmSocketRefs.current.set(helmKey, socket);
    setHelmConnectionState(helmKey, "connecting");
    setDaemonProfileMessage(`正在连接 ${profile.name}...`);

    socket.addEventListener("open", () => {
      setHelmConnectionState(helmKey, "connected");
      setDaemonProfileMessage(`已连接 ${profile.name}`);
      const cache = readTrustedDeviceCache(window.localStorage, profile.host, profile.port);
      if (cache?.token) {
        dispatch(socket, { type: "device.auth", requestId: nextRequestId(requestCounter), deviceId: cache.deviceId, token: cache.token });
      }
    });

    socket.addEventListener("close", () => {
      if (helmSocketRefs.current.get(helmKey) === socket) {
        helmSocketRefs.current.delete(helmKey);
      }
      setHelmConnectionState(helmKey, "disconnected");
    });

    socket.addEventListener("error", () => {
      setHelmConnectionState(helmKey, "disconnected");
      setDaemonProfileMessage(`${profile.name} 连接失败`);
    });
  }

  function connectToDaemon(event?: FormEvent<HTMLFormElement>, options?: { preserveState?: boolean; auto?: boolean; host?: string; port?: string }) {
    event?.preventDefault();
    const preserveState = options?.preserveState ?? false;
    const host = options?.host?.trim() || daemonHost.trim() || DEFAULT_DAEMON_HOST;
    const port = options?.port?.trim() || daemonPort.trim() || DEFAULT_DAEMON_PORT;
    const wsUrl = `ws://${host}:${port}`;

    window.localStorage.setItem(DAEMON_HOST_KEY, host);
    window.localStorage.setItem(DAEMON_PORT_KEY, port);
    socketRef.current?.close();
    if (!preserveState) {
      setSessions([]);
      setStatuses({});
      setMessages({});
      setPermissionRequests({});
      setOutputs({});
      setToolCalls({});
      setDiffs({});
      setSessionConfigOptions({});
      setTrustedDevices([]);
      setActiveSessionId(null);
      setSelectedProjectId(null);
      setResumeFeedback("");
      setCleanupFeedback(null);
    }
    setDebugTrace((current) => ({ ...current, connectClicks: current.connectClicks + 1 }));
    setHelmConnectionState(daemonProfileKey(host, port), "connecting");
    setConnection("connecting");
    setConnectFeedback(`${copy.connectFeedbackConnecting} (${wsUrl})`);
    setPairingState("idle");
    setPairingCodeInput("");
    setPairingFeedback(copy.pairingFeedbackIdle);

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setHelmConnectionState(daemonProfileKey(host, port), "connected");
      setConnection("connected");
      setConnectFeedback(`已连接到 ${wsUrl}`);
      const cache = readTrustedDeviceCache(window.localStorage, host, port);
      if (cache?.token) {
        setTrustedDevice(cache);
        dispatch(socket, { type: "device.auth", requestId: nextRequestId(requestCounter), deviceId: cache.deviceId, token: cache.token });
        setPairingState("waiting");
        setPairingFeedback("正在使用已保存令牌认证...");
        return;
      }
      setPairingState("input");
      setPairingFeedback(copy.pairingHint);
    });

    socket.addEventListener("close", () => {
      setHelmConnectionState(daemonProfileKey(host, port), "disconnected");
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
      if (!options?.auto) {
        setPairingState("idle");
      }
    });

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as HelmToClient;
      handleServerEvent(payload);
    });
  }

  function dispatch(socket: WebSocket, payload: ClientToHelm) {
    socket.send(JSON.stringify(payload));
    setDebugTrace((current) => ({
      ...current,
      requestsSent: current.requestsSent + 1,
      lastRequestType: payload.type,
    }));
  }

  function handleServerEvent(payload: HelmToClient) {
    switch (payload.type) {
      case "device.pair.result":
        if (payload.ok && payload.token) {
          const nextCache: TrustedDeviceCache = {
            deviceId: deckDeviceId,
            token: payload.token,
            trustedUntil: payload.trustedUntil,
            lastAuthenticatedAt: new Date().toISOString(),
          };
          writeTrustedDeviceCache(
            window.localStorage,
            daemonHost.trim() || DEFAULT_DAEMON_HOST,
            daemonPort.trim() || DEFAULT_DAEMON_PORT,
            nextCache,
          );
          setTrustedDevice(nextCache);
          autoConnectAttemptRef.current = null;
          setPairingFeedback(payload.message);
          setPairingState("paired");
          if (socketRef.current) {
            requestInitialSync(socketRef.current);
          }
        } else {
          setPairingFeedback(payload.message);
          setPairingState("rejected");
        }
        return;
      case "device.auth.result":
        if (payload.ok) {
          const existing = readTrustedDeviceCache(
            window.localStorage,
            daemonHost.trim() || DEFAULT_DAEMON_HOST,
            daemonPort.trim() || DEFAULT_DAEMON_PORT,
          );
          if (existing) {
            const nextCache: TrustedDeviceCache = {
              ...existing,
              trustedUntil: payload.trustedUntil ?? existing.trustedUntil,
              lastAuthenticatedAt: new Date().toISOString(),
            };
            writeTrustedDeviceCache(
              window.localStorage,
              daemonHost.trim() || DEFAULT_DAEMON_HOST,
              daemonPort.trim() || DEFAULT_DAEMON_PORT,
              nextCache,
            );
            setTrustedDevice(nextCache);
          }
          autoConnectAttemptRef.current = null;
          setPairingFeedback(payload.message);
          setPairingState("paired");
          if (socketRef.current) {
            requestInitialSync(socketRef.current);
          }
        } else {
          clearTrustedDeviceCache(
            window.localStorage,
            daemonHost.trim() || DEFAULT_DAEMON_HOST,
            daemonPort.trim() || DEFAULT_DAEMON_PORT,
          );
          setTrustedDevice(null);
          setTrustedDevices([]);
          setPairingFeedback(payload.message);
          setPairingState(payload.requiresPairing ? "input" : "rejected");
        }
        return;
      case "device.list.result":
        setTrustedDevices(payload.devices);
        return;
      case "device.revoke.result":
        setTrustedDevices((current) => current.filter((device) => device.deviceId !== payload.deviceId));
        setPairingFeedback(payload.message);
        if (payload.ok && payload.deviceId === deckDeviceId) {
          clearTrustedDeviceCache(
            window.localStorage,
            daemonHost.trim() || DEFAULT_DAEMON_HOST,
            daemonPort.trim() || DEFAULT_DAEMON_PORT,
          );
          setTrustedDevice(null);
          setConnectFeedback("当前设备已被撤销，请重新连接并输入配对码。");
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
            appendUserMessage(payload.session.id, pendingPrompt.raw);
            dispatch(socketRef.current, {
              type: "session.prompt",
              requestId: nextRequestId(requestCounter),
              sessionId: payload.session.id,
              text: pendingPrompt.enhanced,
            });
          }
        }
        return;
      case "session.updated":
        setSessions((current) => upsertSessionSummary(current, payload.session));
        return;
      case "session.config.options":
        setSessionConfigOptions((current) => ({ ...current, [payload.sessionId]: payload.options }));
        setSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId
              ? {
                  ...session,
                  model: payload.state.model ?? session.model,
                  reasoningEffort: payload.state.reasoningEffort ?? session.reasoningEffort,
                  updatedAt: new Date().toISOString(),
                }
              : session,
          ),
        );
        return;
      case "session.list.result":
        setSessions(payload.sessions);
        setStatuses(createSessionStatusMap(payload.sessions));
        setMessages((current) => pruneSessionScopedMap(current, payload.sessions));
        setPermissionRequests((current) => pruneSessionScopedMap(current, payload.sessions));
        setOutputs((current) => pruneSessionScopedMap(current, payload.sessions));
        setDiffs((current) => pruneSessionScopedMap(current, payload.sessions));
        setSessionConfigOptions((current) => pruneSessionScopedMap(current, payload.sessions));
        setActiveSessionId((current) => resolveActiveSessionId(current, payload.sessions));
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
        setToolCalls((current) => ({
          ...current,
          [payload.sessionId]: mergeToolCallHistory(current[payload.sessionId] ?? [], payload.outputs.map(commandChunkToToolCall)),
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
        setSessionConfigOptions((current) => removeSessionRecord(current, payload.result.sessionId));
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
        setToolCalls((current) => ({
          ...current,
          [payload.sessionId]: mergeToolCallHistory(current[payload.sessionId] ?? [], [commandChunkToToolCall(payload.chunk)]),
        }));
        return;
      case "tool.call":
        setToolCalls((current) => ({
          ...current,
          [payload.sessionId]: mergeToolCallHistory(current[payload.sessionId] ?? [], [payload.toolCall]),
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

  function createSession(initialPrompt?: { raw: string; enhanced: string }) {
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
    const profileKey = daemonProfileKey(profile.host, profile.port);
    const nextProfiles = [...daemonProfiles.filter((item) => daemonProfileKey(item.host, item.port) !== profileKey), profile];
    setDaemonProfiles(nextProfiles);
    setDaemonProfileName(name);
    setDaemonProfileMessage(`已保存 Helm：${name}`);
    window.localStorage.setItem(DAEMON_PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
  }

  function revokeTrustedDevice(deviceId: string) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setPairingFeedback("请先连接 Helm 后再管理受信设备。");
      return;
    }

    dispatch(socketRef.current, {
      type: "device.revoke",
      requestId: nextRequestId(requestCounter),
      deviceId,
    });
  }

  function applyDaemonProfile(profile: DaemonProfile) {
    setDaemonHost(profile.host);
    setDaemonPort(profile.port);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(`已切换到 ${profile.name}`);
  }

  function connectDaemonProfile(profile: DaemonProfile) {
    connectHelmSocket(profile);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || !socketRef.current) {
      return;
    }

    const enhancedPrompt = buildEnhancedPrompt(nextPrompt, deckPreferences.promptEnhancer);

    if (!activeSessionId) {
      if (createSession({ raw: nextPrompt, enhanced: enhancedPrompt })) {
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
      text: enhancedPrompt,
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
      deviceId: deckDeviceId,
      deviceName: DECK_DEVICE_NAME,
      clientKind: "web",
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

    const confirmed = window.confirm("将清理当前任务的本地记录；若该任务由 Tiller 创建且 provider 支持，也会尝试删除远端 ACP session。确认继续吗？");
    if (!confirmed) {
      return;
    }

    setCleanupFeedback({ tone: "info", message: "正在清理当前任务..." });
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
              <strong>多 Helm 预设</strong>
              <label>
                <span>预设名称</span>
                <input value={daemonProfileName} onChange={(event) => setDaemonProfileName(event.target.value)} placeholder="工作室 Helm" />
              </label>
              <div className="section-actions">
                <button className="secondary" type="button" onClick={saveDaemonProfile}>
                  保存当前 Helm
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
                <p className="muted compact">还没有保存的 Helm 预设。</p>
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

        {deckPreferences.technicalPanels.showConnectionDebug ? (
          <div className="note-box compact-note">
            <strong>{copy.pairingDebug}</strong>
            <p>
              连接次数={debugTrace.connectClicks} · 配对次数={debugTrace.pairClicks} · 请求数={debugTrace.requestsSent}
            </p>
            <p className="muted compact">最近请求类型={debugTrace.lastRequestType}</p>
          </div>
        ) : null}

        {pairingState === "rejected" && <p className="error-text">配对失败，请检查配对码后重试。</p>}
      </section>
    );
  }

  const showConnectionCard = connection !== "connected" && pairingState !== "paired";
  const showPairingCard = connection === "connected" && pairingState !== "paired";

  function renderOverview() {
    const recentSessions = sessions.slice(0, 5);
    return (
      <section className="workspace-single">
        <header className="hero card hero-panel">
          <div>
            <p className="eyebrow">ACP Coding Agent 舰队指挥甲板</p>
            <h1>Tiller Deck</h1>
            <p className="muted hero-copy">Tiller 是你的 ACP Coding Agent 舰队指挥甲板：调度任务、审批权限、追踪航行日志与文件变更。</p>
          </div>
          <div className="hero-metrics overview-stats">
            <StatCard label="项目" value={String(projects.length)} meta={projects[0]?.name ?? "暂无项目"} />
            <StatCard label="工作区" value={String(workspaces.length)} meta={workspaces[0]?.name ?? copy.noWorkspaces} />
            <StatCard label="舰员" value={String(agents.length)} meta={agents[0]?.name ?? copy.noAgents} />
            <StatCard label="活跃任务" value={String(sessions.length)} meta={activeStatus} />
          </div>
        </header>

        <div className="meta-grid">
          <section className="card surface-card stack-gap">
            <div className="section-head section-head-soft">
              <div>
                <h2>项目列表</h2>
                <p className="muted compact">只读展示当前 Deck 可见的项目 及其绑定 Helm。</p>
              </div>
            </div>
            <InfoList items={projects.map((project) => `${project.name} · ${helms.find((helm) => helm.id === project.helmId)?.name ?? project.helmId}`)} empty="暂无项目" />
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
                <h2>舰员列表</h2>
                <p className="muted compact">只读展示当前可用的 ACP 舰员。</p>
              </div>
            </div>
            <InfoList items={agents.map((agent) => `${agent.name} · ${agent.command} ${(agent.args ?? []).join(" ")}`.trim())} empty={copy.noAgents} />
          </section>
        </div>

        <section className="card surface-card stack-gap">
          <div className="section-head section-head-soft">
            <div>
              <h2>最近任务</h2>
              <p className="muted compact">最近 5 条任务记录，只读展示。</p>
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

  function addMissionPanelPage() {
    const id = `custom-${Date.now().toString(36)}`;
    const page = { id, title: `展示页 ${customMissionPanelPages.length + 1}` };
    setCustomMissionPanelPages((current) => [...current, page]);
    setSelectedMissionPanelPageId(id);
  }

  function renameMissionPanelPage(pageId: string, title: string) {
    setCustomMissionPanelPages((current) => current.map((page) => page.id === pageId ? { ...page, title } : page));
  }

  function deleteMissionPanelPage(pageId: string) {
    setCustomMissionPanelPages((current) => current.filter((page) => page.id !== pageId));
    setSelectedMissionPanelPageId("overview");
  }

  function moveMissionPanelPage(pageId: string, direction: -1 | 1) {
    setCustomMissionPanelPages((current) => moveMissionPanelPageInList(current, pageId, direction));
  }

  function dropMissionPanelPage(targetPageId: string) {
    if (!draggedMissionPanelPageId || draggedMissionPanelPageId === targetPageId) {
      setDraggedMissionPanelPageId(null);
      return;
    }
    setCustomMissionPanelPages((current) => reorderMissionPanelPage(current, draggedMissionPanelPageId, targetPageId));
    setDraggedMissionPanelPageId(null);
  }

  function renderPlainMessages(items: AgentMessage[], commandChunks: CommandChunk[], sessionToolCalls: AgentToolCall[]) {
    const timelineItems = buildConversationTimeline(items, commandChunks, sessionToolCalls);
    if (!timelineItems.length) {
      return <div className="empty-state">{copy.waitingForAgent}</div>;
    }

    return (
      <div className="plain-message-list conversation-timeline">
        {timelineItems.map((item) =>
          item.kind === "message" ? (
            <article key={item.message.id} className={`plain-message plain-${item.message.role}`}>
              <span className="plain-message-role">{copy.role[item.message.role]}</span>
              <MarkdownMessage text={item.message.text} />
            </article>
          ) : (
            <article key={item.id} className={`tool-call-card tool-call-${item.streams.includes("stderr") ? "stderr" : "stdout"}`}>
              <div className="tool-call-head">
                <span className="tool-call-icon" aria-hidden="true">$</span>
                <div>
                  <span className="plain-message-role">工具调用 · {item.status}</span>
                  <strong>{item.title}</strong>
                </div>
                <span className={`tool-call-stream tool-call-stream-${item.streams.includes("stderr") ? "stderr" : "stdout"}`}>{item.streams.includes("stderr") ? "stderr" : "stdout"}</span>
              </div>
              <pre className="tool-call-output">{item.text}</pre>
            </article>
          ),
        )}
      </div>
    );
  }

  function applyMissionPaneDelta(handle: MissionResizeHandle, delta: number, base: MissionPaneWidths) {
    setMissionPaneWidths(() => {
      if (handle === "sidebar") {
        return { ...base, sidebar: clampPaneWidth(base.sidebar + delta, "sidebar") };
      }
      if (handle === "display") {
        return { ...base, display: clampPaneWidth(base.display - delta, "display") };
      }

      const nextDisplay = clampPaneWidth(base.display + delta, "display");
      const displayDelta = nextDisplay - base.display;
      return {
        ...base,
        display: nextDisplay,
        inspector: clampPaneWidth(base.inspector - displayDelta, "inspector"),
      };
    });
  }

  function startMissionPaneResize(handle: MissionResizeHandle, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const base = missionPaneWidths;
    const onMove = (moveEvent: MouseEvent) => {
      applyMissionPaneDelta(handle, moveEvent.clientX - startX, base);
    };
    const onUp = () => {
      document.body.classList.remove("mission-pane-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.classList.add("mission-pane-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  }

  function nudgeMissionPane(handle: MissionResizeHandle, direction: -1 | 1) {
    applyMissionPaneDelta(handle, direction * 24, missionPaneWidths);
  }

  function renderMissionPaneResizer(handle: MissionResizeHandle, label: string) {
    return (
      <button
        type="button"
        className={`mission-pane-resizer mission-pane-resizer-${handle}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        title={label}
        onMouseDown={(event) => startMissionPaneResize(handle, event)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            nudgeMissionPane(handle, -1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            nudgeMissionPane(handle, 1);
          }
        }}
      />
    );
  }

  function renderSessions() {
    const canSend = Boolean(prompt.trim() && socketRef.current && (activeSessionId || (selectedProjectId && selectedWorkspaceId && selectedAgentId)));
    const missionDiffCount = activeSession ? (diffs[activeSession.id] ?? []).length : 0;
    const missionLogCount = activeSession ? (outputs[activeSession.id] ?? []).length : 0;
    const missionPanelPages = [
      { id: "overview", title: "概览" },
      { id: "changes", title: `Git Diff (${missionDiffCount})` },
      { id: "logbook", title: `航行日志 (${missionLogCount})` },
      ...customMissionPanelPages,
    ];
    const selectedMissionPanelPage = missionPanelPages.find((page) => page.id === selectedMissionPanelPageId) ?? missionPanelPages[0];
    const missionLayoutStyle = {
      "--mission-sidebar-width": `${missionPaneWidths.sidebar}px`,
      "--mission-display-width": `${missionPaneWidths.display}px`,
      "--mission-inspector-width": `${missionPaneWidths.inspector}px`,
    } as CSSProperties;
    const renderMissionDisplayPanel = () => (
      <aside className={`mission-display-panel ${activeSession ? "" : "mission-display-empty"}`.trim()} aria-label="任务展示容器">
        <div className="mission-panel-head">
          <div>
            <p className="eyebrow">展示</p>
            <h3>{activeSession ? "任务展示" : "草稿展示"}</h3>
          </div>
          <button className="mission-panel-add" type="button" onClick={addMissionPanelPage} aria-label="增加展示页">＋</button>
        </div>
        {activeSession ? (
          <div className="mission-panel-body">
            <nav className="mission-panel-tree" aria-label="展示页">
              <p className="mission-panel-tree-title">展示页</p>
              {missionPanelPages.map((page) => {
                const custom = page.id.startsWith("custom-");
                return (
                  <button
                    className={`mission-panel-node ${selectedMissionPanelPage.id === page.id ? "active" : ""}`}
                    draggable={custom}
                    key={page.id}
                    type="button"
                    onClick={() => setSelectedMissionPanelPageId(page.id)}
                    onDragStart={() => custom ? setDraggedMissionPanelPageId(page.id) : undefined}
                    onDragOver={(event) => { if (custom) event.preventDefault(); }}
                    onDrop={() => custom ? dropMissionPanelPage(page.id) : undefined}
                  >
                    <span className="mission-panel-node-icon">{page.id === "overview" ? "⌂" : page.id === "changes" ? "◇" : page.id === "logbook" ? "▸" : "□"}</span>
                    <span>{page.title}</span>
                  </button>
                );
              })}
            </nav>
            <section className="mission-panel-content">
              <div className="mission-panel-content-head">
                <div>
                  <p className="eyebrow">{selectedMissionPanelPage.id.startsWith("custom-") ? "自定义" : selectedMissionPanelPage.title}</p>
                  <h3>{selectedMissionPanelPage.title}</h3>
                </div>
                <span className="status-chip">{copy.status[statuses[activeSession.id] ?? activeSession.status]}</span>
              </div>
              {selectedMissionPanelPage.id === "changes" ? (
                <div className="mission-panel-page"><DiffSummary items={diffs[activeSession.id] ?? []} emptyLabel={copy.noDiffSummary} /></div>
              ) : selectedMissionPanelPage.id === "logbook" ? (
                <div className="mission-panel-page"><CommandOutput items={outputs[activeSession.id] ?? []} emptyLabel={copy.noCommandOutput} /></div>
              ) : selectedMissionPanelPage.id.startsWith("custom-") ? (
                <div className="mission-panel-page mission-custom-page">
                  <div className="mission-custom-page-tools">
                    <label>
                      <span>展示页名称</span>
                      <input value={selectedMissionPanelPage.title} onChange={(event) => renameMissionPanelPage(selectedMissionPanelPage.id, event.target.value)} />
                    </label>
                    <div className="mission-custom-page-actions">
                      <button className="secondary" type="button" onClick={() => moveMissionPanelPage(selectedMissionPanelPage.id, -1)}>上移</button>
                      <button className="secondary" type="button" onClick={() => moveMissionPanelPage(selectedMissionPanelPage.id, 1)}>下移</button>
                      <button className="secondary danger-button" type="button" onClick={() => deleteMissionPanelPage(selectedMissionPanelPage.id)}>删除展示页</button>
                    </div>
                  </div>
                  <div className="empty-state">自定义展示页占位，可继续挂载文件树、预览、测试结果或工具输出。</div>
                </div>
              ) : (
                <div className="mission-panel-page">
                  <InfoList title="摘要" items={[`项目 · ${activeSession.projectName}`, `工作区 · ${activeSession.workspaceName}`, `ACP 舰员 · ${activeSession.agentName}`, `发送 · ${activeSession.messageCount} 次`]} empty="暂无摘要" />
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="mission-panel-page mission-panel-empty-page">
            <p className="eyebrow">等待任务</p>
            <h3>创建任务后显示变更、日志与摘要</h3>
            <p className="muted compact">这里会作为 Zed-like 第三栏，承载 Diff、航行日志和自定义展示页。</p>
          </div>
        )}
      </aside>
    );

    return (
      <section className="card surface-card chat-layout chat-layout-sidebar" style={missionLayoutStyle}>
        {pairingState !== "paired" ? (
          <div className="note-box compact-note">
            <strong>任务视图待连接</strong>
            <p>请先在舰队页连接并配对 Helm，再返回这里下达指令。</p>
          </div>
        ) : (
          <>
            <aside className="chat-session-sidebar" aria-label="任务列表">
              <div className="sidebar-section project-switcher">
                <div className="section-head section-head-soft sidebar-heading-block">
                  <div>
                    <h2>项目</h2>
                    <p className="muted compact">先选项目，再进入该项目下的任务。</p>
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
                        <span>{sessionCountsByProject[project.id] ?? 0} 任务</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sidebar-section session-switcher">
                <div className="section-head section-head-soft sidebar-heading-block">
                  <div>
                    <h2>任务</h2>
                    <p className="muted compact">当前项目：{draftProject?.name ?? "未选择"}</p>
                  </div>
                </div>
                <button type="button" className={`chat-session-item ${!activeSession ? "active" : ""}`} onClick={() => setActiveSessionId(null)}>
                  <strong>新任务</strong>
                  <span>{draftProject ? `在 ${draftProject.name} 下创建新的会话` : "先选择项目"}</span>
                </button>
                {projectSessions.length ? (
                  projectSessions.map((session) => (
                    <div key={session.id} className={`session-nav-card ${session.id === activeSessionId ? "active" : ""}`}>
                      <button type="button" className="chat-session-item session-nav-button" onClick={() => openSession(session.id)}>
                        <span className="session-nav-title-row">
                          <strong>{resolveSessionTitle(session)}</strong>
                          <span className="session-nav-time">{formatRelativeTime(session.updatedAt)}</span>
                        </span>
                        <span className="session-nav-meta">{session.agentName} · {copy.status[statuses[session.id] ?? session.status]}</span>
                        <span className="session-nav-preview">{session.lastMessagePreview ?? `${session.workspaceName} · ${session.model ?? "provider-default"}`}</span>
                      </button>
                      <div className="session-nav-actions">
                        <button
                          type="button"
                          className="session-inline-action"
                          aria-label={`清理 ${resolveSessionTitle(session)}`}
                          title="清理任务"
                          onClick={(event) => {
                            event.stopPropagation();
                            cleanupSession(session.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state sidebar-empty">这个项目还没有任务。</div>
                )}
              </div>
            </aside>

            {renderMissionPaneResizer("sidebar", "调整任务列表宽度")}

            <div className="chat-conversation">
              <div className="chat-main">
                {activeSession ? (
                  <>
                    <div className="section-head section-head-soft chat-session-head">
                      <div>
                        <h2>{resolveSessionTitle(activeSession)}</h2>
                        <p className="muted compact">{activeSession.projectName} · {activeSession.workspaceName} · {activeStatus}</p>
                        {deckPreferences.technicalPanels.showSessionRuntimeMeta ? (
                          <>
                            <p className="subtle compact">Helm：{helms.find((helm) => helm.id === activeSession.helmId)?.name ?? activeSession.helmId}</p>
                            <p className="subtle compact">ACP：{activeSession.agentName} · 模型：{activeSession.model ?? "provider-default"} · 推理：{activeSession.reasoningEffort ?? "medium"}</p>
                            <p className="subtle compact">ACP 任务 ID：{activeSession.runtimeSessionId ?? activeSession.resume?.runtimeSessionId ?? "等待 runtime 返回"}</p>
                          </>
                        ) : null}
                        {cleanupFeedback ? <p className={`compact cleanup-feedback cleanup-${cleanupFeedback.tone}`}>{cleanupFeedback.message}</p> : null}
                        {resumeFeedback ? <p className="subtle compact">{resumeFeedback}</p> : null}
                      </div>
                      <div className="section-actions">
                        <button className="secondary" type="button" onClick={startResume}>恢复/重连</button>
                        <button className="secondary" type="button" onClick={cancelSession}>取消任务</button>
                      </div>
                    </div>

                    {pendingPermission ? (
                      <section className="permission-card">
                        <div>
                          <p className="eyebrow">{copy.permissionRequest}</p>
                          <strong>{pendingPermission.command}</strong>
                          <p className="muted compact">{pendingPermission.reason}</p>
                          {deckPreferences.technicalPanels.showPermissionWorkspace ? <p className="subtle compact">{pendingPermission.workspacePath}</p> : null}
                        </div>
                        <div className="permission-actions">
                          <button className="primary" type="button" onClick={() => respondToPermission("allow")}>{copy.allowOnce}</button>
                          <button className="secondary" type="button" onClick={() => respondToPermission("deny")}>{copy.deny}</button>
                        </div>
                      </section>
                    ) : null}

                    {renderPlainMessages(messages[activeSession.id] ?? [], outputs[activeSession.id] ?? [], toolCalls[activeSession.id] ?? [])}

                    <details className="chat-collapsible" open={deckPreferences.technicalPanels.logbookDefaultOpen}>
                      <summary>{copy.commandOutput}</summary>
                      <CommandOutput items={outputs[activeSession.id] ?? []} emptyLabel={copy.noCommandOutput} />
                    </details>
                    <details className="chat-collapsible" open={deckPreferences.technicalPanels.diffDefaultOpen}>
                      <summary>{copy.diffSummary}</summary>
                      <DiffSummary items={diffs[activeSession.id] ?? []} emptyLabel={copy.noDiffSummary} />
                    </details>


                  </>
                ) : (
                  <div className="chat-empty">
                    <p className="eyebrow">新任务</p>
                    <h2>{draftProject ? `在 ${draftProject.name} 下创建新的任务` : "先在左侧选择一个项目"}</h2>
                    <p className="muted">左侧上半是项目，下半是该项目的任务。底部草稿栏里锁定 ACP，可继续调整 模型 / 推理。</p>
                    {cleanupFeedback ? <p className={`compact cleanup-feedback cleanup-${cleanupFeedback.tone}`}>{cleanupFeedback.message}</p> : null}
                  </div>
                )}
              </div>

              <div className="chat-input-area draft-toolbar">
                {!activeSession ? (
                  <div className="draft-toolbar-grid">
                    <label>
                      <span>é¡¹ç®</span>
                      <input value={draftProject?.name ?? "æªéæ©é¡¹ç®"} readOnly />
                    </label>
                    <label>
                      <span>{copy.selectedWorkspace}</span>
                      <select value={selectedWorkspaceId ?? ""} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                        {filteredWorkspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{copy.selectedAgent}</span>
                      <select value={selectedAgentId ?? ""} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={agentLocked}>
                        {filteredAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                <form className="chat-input-form mission-order-editor" onSubmit={submitPrompt}>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={draftPromptPlaceholder}
                  />
                  <div className="mission-composer-sidecar">
                    <div className="mission-composer-tools" aria-hidden="true">
                      <span>＋</span>
                      <span>◎</span>
                    </div>
                    <div className="mission-composer-config" aria-label="当前任务模型配置">
                      <label className="mission-config-card mission-config-model">
                        <span>模型</span>
                        <select
                          value={draftModel}
                          onChange={(event) => updateSessionDraftPreferences({ model: event.target.value })}
                          title={draftModelPlaceholder}
                        >
                          {Array.from(new Set([draftModel, ...draftModelOptions].filter(Boolean))).map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                        <small>{draftModelOptions.length} candidates</small>
                      </label>
                      <label className="mission-config-card mission-config-reasoning">
                        <span>推理</span>
                        <select
                          value={draftReasoningEffort}
                          onChange={(event) => updateSessionDraftPreferences({ reasoningEffort: event.target.value as SessionReasoningEffort })}
                        >
                          {REASONING_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <small>session scope</small>
                      </label>
                    </div>
                    <div className="mission-composer-actions">
                      {deckPreferences.promptEnhancer.enabled ? (
                        <button className="secondary composer-icon-button" type="button" onClick={enhancePromptDraft} disabled={!prompt.trim() || promptEnhancerBusy} aria-label="增强提示词" title="增强提示词">↺</button>
                      ) : null}
                      <button className="primary composer-send-icon" type="submit" disabled={!canSend} aria-label="发送" title="发送">➤</button>
                    </div>
                  </div>
                  {deckPreferences.technicalPanels.showOrderHints ? (
                    <p className="order-editor-hint">左栏按 项目管理任务；ACP 在会话成立后锁定，模型 / 推理 作为当前 session 配置可继续调整。{draftConfigHint}</p>
                  ) : null}
                </form>
              </div>
            </div>

            {renderMissionPaneResizer("display", "调整任务展示宽度")}

            {renderMissionDisplayPanel()}

            {renderMissionPaneResizer("inspector", "调整检视器宽度")}

            <aside className="mission-inspector" aria-label="任务检视器">
              <section className="inspector-section">
                <p className="eyebrow">上下文</p>
                <h3>{activeSession ? resolveSessionTitle(activeSession) : "草稿任务"}</h3>
                <p className="subtle compact">{draftProject?.name ?? "未选项目"} · {activeSession?.workspaceName ?? filteredWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.name ?? "未选工作区"}</p>
                <div className="inspector-pills">
                  <span>{activeSession ? activeStatus : "草稿"}</span>
                  <span>{activeSession?.agentName ?? filteredAgents.find((agent) => agent.id === selectedAgentId)?.name ?? "未选舰员"}</span>
                </div>
              </section>

              <section className="inspector-section model-inspector-section">
                <p className="eyebrow">模型 / 推理</p>
                <div className="model-inspector-hero">
                  <span className="model-inspector-label">MODEL</span>
                  <strong title={draftModel}>{draftModel}</strong>
                </div>
                <div className="model-inspector-grid">
                  <span>推理</span>
                  <strong>{draftReasoningEffort}</strong>
                  <span>候选</span>
                  <strong>{draftModelOptions.length}</strong>
                </div>
                <p className="subtle compact">ACP configOptions 可用时优先展示 provider 的真实模型列表。</p>
              </section>

              <section className="inspector-section inspector-scroll">
                <p className="eyebrow">变更</p>
                <DiffSummary items={activeSession ? diffs[activeSession.id] ?? [] : []} emptyLabel={copy.noDiffSummary} />
              </section>

              <section className="inspector-section inspector-scroll">
                <p className="eyebrow">航行日志</p>
                <CommandOutput items={activeSession ? outputs[activeSession.id] ?? [] : []} emptyLabel={copy.noCommandOutput} />
              </section>
            </aside>
          </>
        )}
      </section>
    );
  }

  function renderAgents() {
    const currentHelmKey = daemonProfileKey(daemonHost.trim() || DEFAULT_DAEMON_HOST, daemonPort.trim() || DEFAULT_DAEMON_PORT);
    const mockHelmProfile: DaemonProfile = { id: "mock-helm", name: "Mock Helm", host: "127.0.0.2", port: "47632" };
    const mockHelmCards = import.meta.env.DEV
      ? [{
          key: daemonProfileKey(mockHelmProfile.host, mockHelmProfile.port),
          name: mockHelmProfile.name,
          host: mockHelmProfile.host,
          port: mockHelmProfile.port,
          isCurrent: false,
          profile: mockHelmProfile,
        }]
      : [];
    const rawHelmCards = [
      {
        key: currentHelmKey,
        name: daemonProfileName.trim() || "Local Helm",
        host: daemonHost.trim() || DEFAULT_DAEMON_HOST,
        port: daemonPort.trim() || DEFAULT_DAEMON_PORT,
        isCurrent: true,
        profile: null as DaemonProfile | null,
      },
      ...daemonProfiles
        .filter((profile) => daemonProfileKey(profile.host, profile.port) !== currentHelmKey)
        .map((profile) => ({
          key: daemonProfileKey(profile.host, profile.port),
          name: profile.name,
          host: profile.host,
          port: profile.port,
          isCurrent: false,
          profile,
        })),
      ...mockHelmCards,
    ];
    const helmCards = dedupeHelmCards(rawHelmCards);
    const selectedKey = selectedHelmKey || currentHelmKey;
    const selectedHelm = helmCards.find((helm) => helm.key === selectedKey) ?? helmCards[0];
    const selectedHelmIsCurrent = selectedHelm.key === currentHelmKey;
    const selectedHelmConnection = resolveHelmConnectionState(selectedHelm, currentHelmKey, connection, helmConnectionStates);
    const selectedHelmIsConnected = selectedHelmConnection === "connected";
    const fleetModalReadyForPairing = fleetAddHelmStage === "pair";

    return (
      <section className="workspace-single">
        {(showConnectionCard || showPairingCard) ? renderConnectionPanel() : null}
        {fleetAddHelmModalOpen ? (
          <div className="fleet-modal-backdrop" role="presentation">
            <section className="card surface-card fleet-add-helm-modal fleet-add-helm-dialog" role="dialog" aria-modal="true" aria-label="添加 Helm">
              <div className="fleet-dialog-head">
                <div>
                  <p className="eyebrow">New Helm</p>
                  <h3>添加 Helm</h3>
                  <p className="muted compact">{fleetModalReadyForPairing ? "连接成功，输入 6 位验证码完成配对。" : "填写 Helm 地址并连接；成功后自动进入验证。"}</p>
                </div>
                <button className="secondary fleet-dialog-close" type="button" onClick={closeFleetAddHelmModal}>关闭</button>
              </div>

              <div className="fleet-dialog-body fleet-dialog-body-single">
                {!fleetModalReadyForPairing ? (
                  <form className="fleet-dialog-card fleet-connect-card" onSubmit={connectFromFleetAddHelmModal}>
                    <div className="fleet-dialog-card-head">
                      <span>01</span>
                      <div>
                        <strong>连接 Helm</strong>
                        <p className="muted compact">输入名称与地址；连接成功后会自动切到验证码。</p>
                      </div>
                    </div>

                    <div className="fleet-connect-grid">
                      <label className="fleet-field-full">
                        <span>Helm 名称</span>
                        <input value={daemonProfileName} onChange={(event) => setDaemonProfileName(event.target.value)} placeholder="本地 Helm" autoFocus />
                      </label>
                      <label>
                        <span>Helm 地址</span>
                        <input value={daemonHost} onChange={(event) => setDaemonHost(event.target.value)} placeholder={DEFAULT_DAEMON_HOST} />
                      </label>
                      <label>
                        <span>端口</span>
                        <input value={daemonPort} onChange={(event) => setDaemonPort(event.target.value.replace(/[^0-9]/g, ""))} placeholder={DEFAULT_DAEMON_PORT} />
                      </label>
                    </div>

                    <div className="section-actions fleet-modal-actions">
                      <button className="primary" type="submit" disabled={fleetAddHelmStage === "connecting"}>{fleetAddHelmStage === "connecting" ? "连接中..." : "连接 Helm"}</button>
                    </div>
                  </form>
                ) : (
                  <form className="fleet-dialog-card fleet-pair-card" onSubmit={submitPairingCode}>
                    <div className="fleet-dialog-card-head">
                      <span>02</span>
                      <div>
                        <strong>输入验证码</strong>
                        <p className="muted compact">请填写 Helm 返回的 6 位验证码。</p>
                      </div>
                    </div>

                    <PairingBoxes
                      refs={pairInputRefs}
                      value={pairingCodeInput}
                      disabled={pairingState === "waiting" || connection !== "connected"}
                      onChange={updatePairingDigit}
                      onKeyDown={handlePairingKeyDown}
                      onPaste={pastePairingDigits}
                    />

                    <div className="section-actions pairing-actions fleet-pair-actions">
                      <button className="primary" type="button" onClick={sendPairingRequest} disabled={pairingCodeInput.length !== 6 || pairingState === "waiting" || connection !== "connected"}>
                        {pairingState === "waiting" ? "提交中..." : "提交验证码"}
                      </button>
                      <button className="secondary" type="button" onClick={() => void connectToDaemon(undefined, { preserveState: true })}>重新连接</button>
                    </div>
                  </form>
                )}
              </div>

              <div className="fleet-dialog-status">
                <span className={`helm-status-dot helm-status-${connection}`} aria-hidden="true" />
                <p className="subtle compact">{daemonProfileMessage || connectFeedback || pairingFeedback || "等待连接 Helm。"}</p>
              </div>
            </section>
          </div>
        ) : null}

        <section className="card surface-card stack-gap fleet-panel fleet-command-panel">
          <div className="section-head section-head-soft fleet-title-row">
            <div>
              <h2>舰队</h2>
            </div>
          </div>

          <section className="fleet-hub" aria-label="舰队 Helm 节点">
            <div className="fleet-hub-head">
              <div>
                <div className="fleet-hub-title-row">
                  <h3>Helm 节点</h3>
                  <span>{helmCards.length} Helm</span>
                </div>
              </div>
              <button className="primary" type="button" onClick={openFleetAddHelmModal}>添加</button>
            </div>

            <p className="fleet-hub-copy">统一管理可用 Helm 节点；选择一个 Helm 后，在下方查看它的项目、ACP 舰员与配置入口。</p>

            <div className="fleet-hub-node-list" role="list" aria-label="Helm 节点列表">
              {helmCards.map((helm) => (
                <button
                  className={`fleet-hub-node ${selectedHelm.key === helm.key ? "active" : ""}`}
                  key={helm.key}
                  type="button"
                  role="listitem"
                  onClick={() => setSelectedHelmKey(helm.key)}
                  aria-pressed={selectedHelm.key === helm.key}
                  title={`${helm.name} · ${helm.host}:${helm.port}`}
                >
                  <span className={`helm-status-dot helm-status-${resolveHelmConnectionState(helm, currentHelmKey, connection, helmConnectionStates)}`} aria-hidden="true" />
                  <span>{helm.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="note-box compact-note fleet-card helm-detail-panel helm-detail-panel-expanded">
            <div className="section-head section-head-soft">
              <div>
                <strong>{selectedHelm.name}</strong>
                <p className="muted compact">{selectedHelm.host}:{selectedHelm.port} · {formatConnectionStatus(selectedHelmConnection)}</p>
              </div>
              <div className="section-actions">
                {!selectedHelmIsConnected && selectedHelm.profile ? (
                  <button className="secondary" type="button" onClick={() => { if (selectedHelm.profile) connectDaemonProfile(selectedHelm.profile); }}>连接此 Helm</button>
                ) : null}
                <button className="secondary" type="button" onClick={() => setAgentConfigExpanded((current) => !current)}>添加舰员</button>
              </div>
            </div>

            <div className="helm-detail-grid helm-inventory-grid">
              <InfoList title="项目列表" items={selectedHelmIsCurrent ? projects.map((project) => project.name) : []} empty={selectedHelmIsConnected ? "当前 Helm 暂无项目数据" : "请先连接该 Helm 后加载项目"} />
              <InfoList title="ACP 舰员" items={selectedHelmIsCurrent ? agents.map((agent) => `${agent.name} · ${agent.command} ${(agent.args ?? []).join(" ")}`.trim()) : []} empty={selectedHelmIsConnected ? copy.noAgents : "请先连接该 Helm 后加载舰员"} />
            </div>

            <section className="helm-config-panel">
              <div className="section-head section-head-soft">
                <div>
                  <h3>项目配置</h3>
                </div>
                <p className="muted compact">项目、模型与 provider 能力归属当前 Helm。</p>
              </div>
              <div className="helm-config-placeholder">
                <strong>项目</strong>
                <span>这里承载当前 Helm 的项目级配置入口；Deck Settings 只保留前端偏好。</span>
              </div>
            </section>

            <section className="helm-config-panel helm-agent-config-panel">
              <div className="section-head section-head-soft">
                <div>
                  <h3>{copy.addAgentDraft}</h3>
                </div>
                <p className="muted compact">默认收起；展开后写入当前 Helm。</p>
              </div>

              {agentConfigExpanded ? (
                <form className="config-form" onSubmit={saveDraft}>
                  <div className="section-head">
                    <h3>{copy.addAgentDraft}</h3>
                    <div className="section-actions">
                      <button className="secondary" type="submit">本地保存草稿</button>
                      <button className="primary" type="button" onClick={writeDraftToConfig} disabled={connection !== "connected" || !agentDraft.command.trim()}>写入 Helm 配置</button>
                    </div>
                  </div>

                  {!selectedHelmIsCurrent ? (
                    <div className="note-box compact-note target-helm-warning">
                      <strong>目标 Helm 尚未连接</strong>
                      <p className="muted compact">Deck 只能向当前已连接 Helm 写入舰员配置，请先连接目标 Helm。</p>
                    </div>
                  ) : null}

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
              ) : (
                <button className="helm-config-placeholder helm-agent-placeholder" type="button" onClick={() => setAgentConfigExpanded(true)}>
                  <strong>agent</strong>
                  <span>点击展开 ACP 舰员配置表单，并写入当前 Helm。</span>
                </button>
              )}
            </section>
          </section>
        </section>
      </section>
    );
  }

  function renderSettings() {
    const settingsCopy = deckPreferences.language === "en-US"
      ? {
          title: "Settings",
          subtitle: "Configure Deck theme, language, technical panels, and prompt enhancement. All options are stored locally in this browser.",
          reset: "Reset defaults",
          languageEyebrow: "Language",
          languageLabel: "Language",
          languageHelp: "Switches navigation and core Settings copy; ACP Crew domain terms keep their original names.",
          themeEyebrow: "Theme",
          themeLabel: "Theme",
          themeSystem: "System",
          themeLight: "Light",
          themeDark: "Dark",
          themeHelp: "Theme only affects this Deck and is not written to Helm or Crew config.",
          motionEyebrow: "Motion",
          reduceMotion: "Reduce transition animations",
          technicalEyebrow: "Technical panel controls",
          technicalTitle: "Choose which diagnostic details are visible by default",
          logbookOpen: "Open Logbook by default",
          diffOpen: "Open diff summary by default",
          runtimeMeta: "Show Session runtime metadata",
          permissionWorkspace: "Show permission request workspace path",
          orderHints: "Show composer configuration hints",
          connectionDebug: "Show connection/pairing debug echo",
          enhancerEyebrow: "Prompt enhancement",
          enhancerTitle: "Wrap casual chat as a standard prompt",
          enhancerEnabled: "Enable before send",
          enhancerHelp: "Enhancement is prepended before sending to ACP; the chat window still shows your original input and nothing is written to Helm/backend config.",
          instructionLabel: "Enhanced prompt textbox · Role and goal",
          modelLabel: "Model config position · Reasoning preference",
          contractLabel: "Output contract",
          saveEyebrow: "Saved state",
          browserTitle: "Current browser",
          saveStatus: "Frontend preferences are auto-saved; backend, provider, and Helm-level settings still belong to the concrete Helm / Crew.",
          devicesEyebrow: "Trusted devices",
          devicesTitle: "7-day remembered Deck / App devices",
          devicesHelp: "Each trusted device is scoped to this Helm profile. Revoking a device forces it to pair again on that device.",
          devicesEmpty: "No trusted devices yet.",
          currentDevice: "Current device",
          revoke: "Revoke",
          clientKindWeb: "Web",
          clientKindApp: "App",
          lastSeen: "Last seen",
          expiresAt: "Expires",
        }
      : {
          title: "设置",
          subtitle: "配置 Deck 语言、主题、技术面板与提示词增强；所有选项只保存在浏览器本地。",
          reset: "重置默认",
          languageEyebrow: "语言 / Language",
          languageLabel: "语言",
          languageHelp: "用于切换导航与 设置基础文案；ACP 舰员 领域术语保持原名。",
          themeEyebrow: "主题切换",
          themeLabel: "主题",
          themeSystem: "跟随系统",
          themeLight: "浅色",
          themeDark: "深色",
          themeHelp: "主题只影响当前 Deck，不会写入 Helm 或舰员配置。",
          motionEyebrow: "动效",
          reduceMotion: "减少过渡动画",
          technicalEyebrow: "技术面板控制",
          technicalTitle: "决定哪些诊断信息默认展示",
          logbookOpen: "默认展开航行日志",
          diffOpen: "默认展开变更摘要",
          runtimeMeta: "显示任务 runtime 元信息",
          permissionWorkspace: "显示权限请求工作区路径",
          orderHints: "显示发送区配置提示",
          connectionDebug: "显示连接/配对调试回显",
          enhancerEyebrow: "提示词增强",
          enhancerTitle: "把普通对话包装成标准提示词",
          enhancerEnabled: "发送前启用",
          enhancerHelp: "增强内容会在发送到 ACP 前拼接；聊天窗口仍显示你的原始输入，不会写入 Helm 或后端配置。",
          instructionLabel: "增强提示词文本框 · 角色与目标",
          modelLabel: "模型配置位置 · 推理偏好",
          contractLabel: "输出契约",
          saveEyebrow: "保存状态",
          browserTitle: "当前浏览器",
          saveStatus: "前端偏好会自动保存；后端、provider、Helm 级配置仍在具体 Helm / 舰员中管理。",
          devicesEyebrow: "信标",
          devicesTitle: "当前 Helm 记住的 7 天信标",
          devicesHelp: "每个信标都只属于当前 Helm profile。撤销后，该设备下次必须重新配对。",
          devicesEmpty: "当前还没有信标。",
          currentDevice: "当前信标",
          revoke: "撤销",
          clientKindWeb: "网页",
          clientKindApp: "App",
          lastSeen: "最近认证",
          expiresAt: "信任到期",
        };

    return (
      <section className="workspace-single">
        <section className="card surface-card stack-gap">
          <div className="section-head section-head-soft">
            <div>
              <h2>{settingsCopy.title}</h2>
            </div>
            <button className="secondary" type="button" onClick={resetDeckPreferences}>{settingsCopy.reset}</button>
          </div>

          <div className="settings-grid settings-form">
            <section className="note-box settings-card">
              <label>
                <span>{settingsCopy.languageLabel}</span>
                <select
                  aria-label={settingsCopy.languageLabel}
                  value={deckPreferences.language}
                  onChange={(event) => updateDeckPreference("language", event.target.value as DeckLanguage)}
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
            </section>

            <section className="note-box settings-card">
              <label>
                <span>{settingsCopy.themeLabel}</span>
                <select
                  value={deckPreferences.theme}
                  onChange={(event) => updateDeckPreference("theme", event.target.value as DeckTheme)}
                >
                  <option value="system">{settingsCopy.themeSystem}</option>
                  <option value="light">{settingsCopy.themeLight}</option>
                  <option value="dark">{settingsCopy.themeDark}</option>
                </select>
              </label>
            </section>

            <section className="note-box settings-card">
              <p className="eyebrow">{settingsCopy.motionEyebrow}</p>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={deckPreferences.reduceMotion}
                  onChange={(event) => updateDeckPreference("reduceMotion", event.target.checked)}
                />
                <span>{settingsCopy.reduceMotion}</span>
              </label>
            </section>

            <section className="note-box settings-card settings-card-full">
              <p className="eyebrow">{settingsCopy.technicalEyebrow}</p>
              <h3>{settingsCopy.technicalTitle}</h3>
              <div className="settings-control-grid">
                <label className="toggle-row">
                  <input type="checkbox" checked={deckPreferences.technicalPanels.logbookDefaultOpen} onChange={(event) => updateTechnicalPanelPreference("logbookDefaultOpen", event.target.checked)} />
                  <span>{settingsCopy.logbookOpen}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={deckPreferences.technicalPanels.diffDefaultOpen} onChange={(event) => updateTechnicalPanelPreference("diffDefaultOpen", event.target.checked)} />
                  <span>{settingsCopy.diffOpen}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={deckPreferences.technicalPanels.showSessionRuntimeMeta} onChange={(event) => updateTechnicalPanelPreference("showSessionRuntimeMeta", event.target.checked)} />
                  <span>{settingsCopy.runtimeMeta}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={deckPreferences.technicalPanels.showPermissionWorkspace} onChange={(event) => updateTechnicalPanelPreference("showPermissionWorkspace", event.target.checked)} />
                  <span>{settingsCopy.permissionWorkspace}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={deckPreferences.technicalPanels.showOrderHints} onChange={(event) => updateTechnicalPanelPreference("showOrderHints", event.target.checked)} />
                  <span>{settingsCopy.orderHints}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={deckPreferences.technicalPanels.showConnectionDebug} onChange={(event) => updateTechnicalPanelPreference("showConnectionDebug", event.target.checked)} />
                  <span>{settingsCopy.connectionDebug}</span>
                </label>
              </div>
            </section>

            <section className="note-box settings-card settings-card-full prompt-enhancer-card">
              <div className="settings-card-head">
                <div>
                  <p className="eyebrow">提示词增强</p>
                  <h3>LLM 增强器</h3>
                </div>
              </div>
              <div className="prompt-enhancer-grid prompt-llm-grid">
                <label>
                  <span>OpenAI-compatible Base URL</span>
                  <input value={deckPreferences.promptEnhancer.llm.baseUrl} onChange={(event) => updatePromptEnhancerLlmPreference("baseUrl", event.target.value)} placeholder="http://localhost:8317" />
                </label>
                <label>
                  <span>增强模型</span>
                  <div className="prompt-model-combobox" ref={promptModelPickerRef}>
                    <div className="prompt-model-input-row">
                      <input
                        value={deckPreferences.promptEnhancer.llm.model}
                        onChange={(event) => updatePromptEnhancerModelInput(event.target.value)}
                        onFocus={() => setPromptEnhancerModelPickerOpen(true)}
                        placeholder="gpt-4.1-mini"
                        autoComplete="off"
                      />
                      <button className="secondary" type="button" onClick={refreshPromptEnhancerModels} disabled={promptEnhancerBusy}>{promptEnhancerBusy ? "加载" : "刷新"}</button>
                    </div>
                    {promptEnhancerModelPickerOpen && (
                      <div className="prompt-model-picker" role="listbox" aria-label="增强模型列表">
                        <input
                          className="prompt-model-filter"
                          value={promptEnhancerModelFilter}
                          onChange={(event) => setPromptEnhancerModelFilter(event.target.value)}
                          placeholder="搜索模型或 owner"
                          aria-label="搜索增强模型"
                        />
                        {promptEnhancerBusy ? <p className="prompt-model-empty">正在从 /v1/models 获取模型...</p> : null}
                        {!promptEnhancerBusy && promptEnhancerModels.length === 0 ? <p className="prompt-model-empty">点击刷新，从 /v1/models 加载可用模型。</p> : null}
                        {!promptEnhancerBusy && promptEnhancerModels.length > 0 && groupPromptEnhancerModels(promptEnhancerModels, promptEnhancerModelFilter).length === 0 ? <p className="prompt-model-empty">没有匹配的模型。</p> : null}
                        {!promptEnhancerBusy && groupPromptEnhancerModels(promptEnhancerModels, promptEnhancerModelFilter).map((group) => (
                          <div className="prompt-model-group" key={group.owner}>
                            <p className="prompt-model-owner">{group.owner}<span>{group.models.length}</span></p>
                            <div className="prompt-model-option-list">
                              {group.models.map((model) => (
                                <button
                                  className={`prompt-model-option ${model.id === deckPreferences.promptEnhancer.llm.model ? "active" : ""}`}
                                  key={`${model.ownedBy}:${model.id}`}
                                  type="button"
                                  role="option"
                                  aria-selected={model.id === deckPreferences.promptEnhancer.llm.model}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => selectPromptEnhancerModel(model)}
                                >
                                  {model.id}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
                <label className="settings-card-full">
                  <span>API Key</span>
                  <input type="password" value={deckPreferences.promptEnhancer.llm.apiKey} onChange={(event) => updatePromptEnhancerLlmPreference("apiKey", event.target.value)} placeholder="sk-..." autoComplete="off" />
                </label>
                <label className="settings-card-full">
                  <span>增强器 System Prompt</span>
                  <textarea value={deckPreferences.promptEnhancer.llm.systemPrompt} onChange={(event) => updatePromptEnhancerLlmPreference("systemPrompt", event.target.value)} placeholder={DEFAULT_PROMPT_LLM_SYSTEM_PROMPT} />
                </label>
                <label className="settings-card-full">
                  <span>增强器指令模板</span>
                  <textarea value={deckPreferences.promptEnhancer.llm.instructionTemplate} onChange={(event) => updatePromptEnhancerLlmPreference("instructionTemplate", event.target.value)} placeholder={DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE} />
                </label>
                <div className="section-actions settings-card-full">
                  <button className="secondary" type="button" onClick={resetPromptEnhancerDefaults}>恢复默认模板</button>
                  <button className="secondary" type="button" onClick={testPromptEnhancerSelectedModel} disabled={promptEnhancerBusy}>测试连通性</button>
                  {promptEnhancerStatus ? <span className="settings-status">{promptEnhancerStatus}</span> : null}
                </div>
              </div>
            </section>

            <section className="note-box settings-card settings-card-full">
              <div className="settings-card-head">
                <div>
                  <p className="eyebrow">{settingsCopy.devicesEyebrow}</p>
                  <h3>{settingsCopy.devicesTitle}</h3>
                </div>
              </div>
              {trustedDevices.length ? (
                <div className="trusted-device-list">
                  {trustedDevices.map((device) => {
                    const isCurrentDevice = device.deviceId === deckDeviceId;
                    return (
                      <article key={device.deviceId} className={isCurrentDevice ? "trusted-device-row trusted-device-row-current" : "trusted-device-row"}>
                        <div className="trusted-device-icon" aria-hidden="true">
                          {device.clientKind === "app" ? "▣" : "⌁"}
                        </div>
                        <div className="trusted-device-copy">
                          <div className="trusted-device-title-row">
                            <strong>{device.deviceName}</strong>
                            <span className="status-chip subtle-chip">{device.clientKind === "app" ? settingsCopy.clientKindApp : settingsCopy.clientKindWeb}</span>
                            {isCurrentDevice ? <span className="status-chip">{settingsCopy.currentDevice}</span> : null}
                          </div>
                          <p className="subtle compact device-mono">{device.deviceId}</p>
                          <div className="trusted-device-meta-grid">
                            <span>{settingsCopy.lastSeen} · {formatDeviceTime(device.lastSeenAt)}</span>
                            <span>{settingsCopy.expiresAt} · {formatDeviceTime(device.expiresAt)}</span>
                          </div>
                        </div>
                        <div className="trusted-device-actions">
                          <button className="secondary" type="button" onClick={() => revokeTrustedDevice(device.deviceId)}>
                            {settingsCopy.revoke}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">{settingsCopy.devicesEmpty}</div>
              )}
            </section>
          </div>
        </section>
      </section>
    );
  }

  return (
    <main className={`shell view-${activeView} theme-${deckPreferences.theme} ${deckPreferences.reduceMotion ? "motion-reduced" : ""}`}>
      <TopNav activeView={activeView} onNavigate={navigateToView} connection={connection} language={deckPreferences.language} />
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
  if (normalized === "/sessions") {
    return "sessions";
  }
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

function resolveCleanupFeedback(result: Extract<HelmToClient, { type: "session.cleanup.result" }>['result']): CleanupFeedback {
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


function daemonProfileKey(host: string, port: string) {
  return `${host}:${port}`;
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

function readMissionPanelPages(): MissionPanelPage[] {
  try {
    const raw = window.localStorage.getItem(MISSION_PANEL_PAGES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecord).map((page, index) => ({
      id: typeof page.id === "string" && page.id ? page.id : `custom-${index + 1}`,
      title: typeof page.title === "string" && page.title ? page.title : `展示页 ${index + 1}`,
    })) : [];
  } catch {
    return [];
  }
}

function moveMissionPanelPageInList(pages: MissionPanelPage[], pageId: string, direction: -1 | 1) {
  const index = pages.findIndex((page) => page.id === pageId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= pages.length) return pages;
  const next = [...pages];
  const [page] = next.splice(index, 1);
  next.splice(nextIndex, 0, page);
  return next;
}

function reorderMissionPanelPage(pages: MissionPanelPage[], sourceId: string, targetId: string) {
  const sourceIndex = pages.findIndex((page) => page.id === sourceId);
  const targetIndex = pages.findIndex((page) => page.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return pages;
  const next = [...pages];
  const [page] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, page);
  return next;
}

function readDeckPreferences(): DeckPreferences {
  try {
    const raw = window.localStorage.getItem(DECK_PREFERENCES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const technicalPanels = isRecord(parsed.technicalPanels) ? parsed.technicalPanels : {};
    const promptEnhancer = isRecord(parsed.promptEnhancer) ? parsed.promptEnhancer : {};
    const legacyTechnicalPanelsOpen = parsed.showTechnicalPanels === true;

    return {
      language: isDeckLanguage(parsed.language) ? parsed.language : DEFAULT_DECK_PREFERENCES.language,
      theme: isDeckTheme(parsed.theme) ? parsed.theme : DEFAULT_DECK_PREFERENCES.theme,
      reduceMotion: parsed.reduceMotion === true,
      technicalPanels: {
        logbookDefaultOpen: typeof technicalPanels.logbookDefaultOpen === "boolean" ? technicalPanels.logbookDefaultOpen : legacyTechnicalPanelsOpen,
        diffDefaultOpen: typeof technicalPanels.diffDefaultOpen === "boolean" ? technicalPanels.diffDefaultOpen : legacyTechnicalPanelsOpen,
        showSessionRuntimeMeta: typeof technicalPanels.showSessionRuntimeMeta === "boolean" ? technicalPanels.showSessionRuntimeMeta : DEFAULT_DECK_PREFERENCES.technicalPanels.showSessionRuntimeMeta,
        showPermissionWorkspace: typeof technicalPanels.showPermissionWorkspace === "boolean" ? technicalPanels.showPermissionWorkspace : DEFAULT_DECK_PREFERENCES.technicalPanels.showPermissionWorkspace,
        showOrderHints: typeof technicalPanels.showOrderHints === "boolean" ? technicalPanels.showOrderHints : DEFAULT_DECK_PREFERENCES.technicalPanels.showOrderHints,
        showConnectionDebug: typeof technicalPanels.showConnectionDebug === "boolean" ? technicalPanels.showConnectionDebug : DEFAULT_DECK_PREFERENCES.technicalPanels.showConnectionDebug,
      },
      promptEnhancer: {
        enabled: typeof promptEnhancer.enabled === "boolean" ? promptEnhancer.enabled : DEFAULT_DECK_PREFERENCES.promptEnhancer.enabled,
        instruction: readPreferenceText(promptEnhancer.instruction, DEFAULT_PROMPT_ENHANCER_INSTRUCTION),
        modelProfile: readPreferenceText(promptEnhancer.modelProfile, DEFAULT_PROMPT_MODEL_PROFILE),
        responseContract: readPreferenceText(promptEnhancer.responseContract, DEFAULT_PROMPT_RESPONSE_CONTRACT),
        llm: {
          enabled: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.enabled === "boolean" ? promptEnhancer.llm.enabled : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.enabled,
          baseUrl: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.baseUrl === "string" ? promptEnhancer.llm.baseUrl : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.baseUrl,
          apiKey: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.apiKey === "string" ? promptEnhancer.llm.apiKey : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.apiKey,
          model: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.model === "string" ? promptEnhancer.llm.model : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.model,
          systemPrompt: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.systemPrompt === "string" && promptEnhancer.llm.systemPrompt !== OLD_PROMPT_LLM_SYSTEM_PROMPT ? promptEnhancer.llm.systemPrompt : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.systemPrompt,
          instructionTemplate: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.instructionTemplate === "string" && promptEnhancer.llm.instructionTemplate !== OLD_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE ? promptEnhancer.llm.instructionTemplate : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.instructionTemplate,
        },
      },
    };
  } catch {
    return DEFAULT_DECK_PREFERENCES;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDeckLanguage(value: unknown): value is DeckLanguage {
  return value === "zh-CN" || value === "en-US";
}

function isDeckTheme(value: unknown): value is DeckTheme {
  return value === "system" || value === "light" || value === "dark";
}

function readPreferenceText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
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

function resolveSessionTitle(session: SessionSummary) {
  const preview = session.lastMessagePreview?.trim();
  if (preview && /[A-Za-z0-9一-鿿]/u.test(preview)) {
    return preview.replaceAll("`r", " ").replaceAll("`n", " ").slice(0, 36);
  }

  return `${session.projectName} 任务`;
}

function resolveModelOptions(currentModel?: string, configOptions: SessionConfigOption[] = [], nativeOptions: AcpModelOption[] = []) {
  const resolved = resolveModelOptionsFromConfig(undefined, configOptions, nativeOptions);
  return resolved.length ? resolved : currentModel ? [currentModel] : [];
}

function resolveReasoningOptions(configOptions: SessionConfigOption[] = []) {
  const option = configOptions.find((item) => ["thought_level", "reasoning", "reasoning_effort"].includes(item.category?.toLowerCase() ?? ""));
  const values = (option?.options ?? [])
    .map((item) => item.value)
    .filter((value): value is SessionReasoningEffort => typeof value === "string" && REASONING_OPTIONS.some((candidate) => candidate.value === value));
  return Array.from(new Set(values));
}

function resolveReasoningLabel(value: SessionReasoningEffort) {
  return REASONING_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function resolveDraftConfigOptions(
  activeSession: SessionSummary | null,
  sessions: SessionSummary[],
  sessionConfigOptions: Record<string, SessionConfigOption[]>,
  selectedAgentId?: string | null,
) {
  if (activeSession) {
    return sessionConfigOptions[activeSession.id] ?? [];
  }

  const cachedSession = sessions.find((session) => session.agentId === selectedAgentId && (sessionConfigOptions[session.id]?.length ?? 0) > 0);
  return cachedSession ? sessionConfigOptions[cachedSession.id] ?? [] : [];
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
      ? " 该 provider 会在下次 runtime 启动/恢复时应用模型与推理 覆盖。"
      : " 该 provider 的新会话会直接写入 模型 / 推理。";
  }

  if (support.model === "startup" && support.reasoningEffort === "none") {
    return activeSession
      ? " 该 provider 会在下次 runtime 启动/恢复时应用模型覆盖；若当前 provider/model 支持 reasoningEffort，Tiller 也会通过 inline config 尝试带入，否则仍只保存在 session 配置中。模型请使用 provider/model 形式，例如 openai/gpt-5.4。"
      : " 该 provider 的新会话支持写入模型；若当前 provider/model 支持 reasoningEffort，Tiller 也会通过 inline config 尝试带入，否则仅保存在 session 配置中。模型请使用 provider/model 形式，例如 openai/gpt-5.4。";
  }

  return activeSession
    ? " 当前 provider 暂未暴露通用的运行时 模型/推理热切换接口，Tiller 会先保存为 session 配置。"
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

function summarizeSessionContext(session: SessionSummary | null, sessionMessages: AgentMessage[]) {
  if (!session) {
    return "暂无活跃任务；请先增强新任务草稿。";
  }
  const recentMessages = sessionMessages.slice(-4).map((message) => `${message.role}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 180)}`);
  return [
    `Session ${session.id} is ${session.status}; messages: ${session.messageCount}.`,
    session.lastMessagePreview ? `最近意图/结果：${session.lastMessagePreview}` : "",
    recentMessages.length ? ["最近消息：", ...recentMessages.map((message) => `- ${message}`)].join("\n") : "",
  ].filter(Boolean).join("\n");
}

function resolveHelmConnectionState(
  helm: { key: string; isCurrent: boolean },
  currentHelmKey: string,
  globalConnection: "connecting" | "connected" | "disconnected",
  helmConnectionStates: Record<string, "connecting" | "connected" | "disconnected">,
) {
  return helmConnectionStates[helm.key] ?? (helm.key === currentHelmKey ? globalConnection : "disconnected");
}

function dedupeHelmCards<T extends { key: string; isCurrent: boolean }>(cards: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const card of cards) {
    if (seen.has(card.key)) {
      continue;
    }
    seen.add(card.key);
    result.push(card);
  }
  return result;
}

function groupPromptEnhancerModels(models: PromptEnhancerModelOption[], filter: string) {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, PromptEnhancerModelOption[]>();
  for (const model of models) {
    if (needle && !model.id.toLowerCase().includes(needle) && !model.ownedBy.toLowerCase().includes(needle)) {
      continue;
    }
    const owner = model.ownedBy || "default";
    groups.set(owner, [...(groups.get(owner) ?? []), model]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, ownerModels]) => ({ owner, models: ownerModels.sort((left, right) => left.id.localeCompare(right.id)) }));
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

function formatDeviceTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString(deckLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deckLocale() {
  return document.documentElement.lang || "zh-CN";
}


