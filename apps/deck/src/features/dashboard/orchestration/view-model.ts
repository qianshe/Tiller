import type {
  AgentPlan,
  AgentMessage,
  CanonicalApproval,
  HelmSummary,
  PermissionDecision,
  PermissionRequestOption,
  SessionStatus,
  SessionSummary,
  SessionTimelineEntry,
  SessionActivitySummary,
  ConversationPreparation,
} from "@tiller/shared";
import { resolvePermissionCommandDisplay } from "../../mission/facade";
import { daemonProfileKey } from "../../helm-connection/facade";
import type { DeckNotificationDetails } from "../../../store";
import type { DashboardActivityTrendPoint } from "../types";

type DashboardHelmInventory = {
  agents?: unknown[];
  agentConnections?: Array<{ providerId?: unknown; status?: string }>;
  sessions?: SessionSummary[];
  statuses?: Record<string, SessionStatus | undefined>;
  activitySummary?: SessionActivitySummary;
};

type DashboardInput = {
  connection: string;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  activeHelm?: { id?: string; name?: string; host?: string; port?: string | number } | null;
  helms?: Array<Partial<HelmSummary> & Record<string, unknown>>;
  configuredHelms?: Array<Partial<HelmSummary> & Record<string, unknown>>;
  currentHelmKey?: string;
  helmConnectionStates?: Record<string, "connecting" | "connected" | "disconnected">;
  helmInventories?: Record<string, DashboardHelmInventory | undefined>;
  agents: unknown[];
  agentConnectionInventory?: Array<{ providerId?: unknown; status?: string }>;
  projects: unknown[];
  sessions: SessionSummary[];
  preparations?: ConversationPreparation[];
  statuses?: Record<string, SessionStatus | undefined>;
  selectedSessionId?: string | null;
  sessionPlans?: Record<string, AgentPlan | undefined>;
  toolCalls: Record<string, unknown[]>;
  messages?: Record<string, AgentMessage[]>;
  sessionTimeline?: Record<string, SessionTimelineEntry[]>;
  activitySummary?: SessionActivitySummary;
  now?: number;
  approvalItemsById: Record<string, any>;
  approvalHistory?: CanonicalApproval[];
  notifications?: DashboardNotification[];
  resolveDisplaySessionTitle: (session: SessionSummary) => string;
};

type DashboardPlanSummary = {
  completed: number;
  total: number;
  label: string;
};

export type DashboardNotification = {
  id: string;
  kind: "error" | "warning" | "info";
  message: string;
  source?: string;
  code?: string;
  sessionId?: string;
  sessionName?: string;
  details?: DeckNotificationDetails;
  createdAt: string;
};

const DASHBOARD_APPROVAL_DECISIONS: PermissionDecision[] = [
  "deny",
  "allow",
  "allow_session",
  "allow_always",
];
const DASHBOARD_DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_HOUR_MS = 60 * 60 * 1000;
const DASHBOARD_TREND_DAYS = 30;
const DASHBOARD_TREND_HOURS = 24;

function dashboardText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDashboardTimestamp(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isRecentDashboardTimestamp(value: unknown, cutoff: number) {
  const timestamp = parseDashboardTimestamp(value);
  return timestamp !== null && timestamp >= cutoff;
}

type DashboardActivityEvent = {
  kind: "prompt" | "tool";
  timestamp: unknown;
};

function resolveDashboardActivityKey(sessionId: string, id: unknown) {
  return typeof id === "string" && id.length > 0 ? `${sessionId}:${id}` : null;
}

function collectDashboardActivityEvents(
  sessionTimeline: Record<string, SessionTimelineEntry[]> | undefined,
  messages: Record<string, AgentMessage[]> | undefined,
  toolCalls: Record<string, unknown[]>,
): DashboardActivityEvent[] {
  const events: DashboardActivityEvent[] = [];
  const promptKeys = new Set<string>();
  const toolKeys = new Set<string>();

  for (const [sessionId, entries] of Object.entries(sessionTimeline ?? {})) {
    for (const entry of entries) {
      if (entry.kind === "user_message") {
        const key = resolveDashboardActivityKey(sessionId, entry.id);
        if (key) promptKeys.add(key);
        events.push({ kind: "prompt", timestamp: entry.timestamp });
      } else if (entry.kind === "tool_call") {
        const key = resolveDashboardActivityKey(sessionId, entry.toolCall.id);
        if (key) toolKeys.add(key);
        events.push({ kind: "tool", timestamp: entry.toolCall.timestamp ?? entry.timestamp });
      }
    }
  }

  // Message and tool-call maps are live/open-session caches. Keep them as a
  // fallback for sessions whose canonical timeline has not been hydrated yet.
  for (const [sessionId, sessionMessages] of Object.entries(messages ?? {})) {
    for (const message of sessionMessages) {
      if (message.role !== "user") continue;
      const key = resolveDashboardActivityKey(sessionId, message.id);
      if (key && promptKeys.has(key)) continue;
      if (key) promptKeys.add(key);
      events.push({ kind: "prompt", timestamp: message.timestamp });
    }
  }

  for (const [sessionId, sessionToolCalls] of Object.entries(toolCalls ?? {})) {
    for (const call of sessionToolCalls) {
      if (!call || typeof call !== "object") continue;
      const typedCall = call as { id?: unknown; timestamp?: unknown };
      const key = resolveDashboardActivityKey(sessionId, typedCall.id);
      if (key && toolKeys.has(key)) continue;
      if (key) toolKeys.add(key);
      events.push({ kind: "tool", timestamp: typedCall.timestamp });
    }
  }

  return events;
}

function countRecentDashboardActivity(
  events: DashboardActivityEvent[],
  kind: DashboardActivityEvent["kind"],
  cutoff: number,
) {
  return events.filter(
    (event) => event.kind === kind && isRecentDashboardTimestamp(event.timestamp, cutoff),
  ).length;
}

function mergeDashboardActivityTrend(
  points: DashboardActivityTrendPoint[],
  events: DashboardActivityEvent[],
  generatedAt: number,
  now: number,
  bucketMs: number,
  formatDate: (timestampMs: number) => string,
) {
  const next = points.map((point) => ({ ...point }));
  const pointsByDate = new Map(next.map((point) => [point.date, point]));
  for (const event of events) {
    const timestamp = parseDashboardTimestamp(event.timestamp);
    if (timestamp === null || timestamp <= generatedAt || timestamp > now) continue;
    const point = pointsByDate.get(formatDate(Math.floor(timestamp / bucketMs) * bucketMs));
    if (!point) continue;
    point[event.kind === "prompt" ? "promptCount" : "toolCallCount"] += 1;
  }
  return next;
}

function resolveDashboardActivityMetrics(
  summary: SessionActivitySummary | undefined,
  events: DashboardActivityEvent[],
  now: number,
) {
  if (!summary) {
    return {
      promptCount: countRecentDashboardActivity(events, "prompt", now - DASHBOARD_DAY_MS),
      recentToolCallCount: countRecentDashboardActivity(events, "tool", now - DASHBOARD_DAY_MS),
      toolCallCount: events.filter((event) => event.kind === "tool").length,
      activityTrend: buildDashboardBucketedActivityTrend(
        events,
        now,
        DASHBOARD_DAY_MS,
        DASHBOARD_TREND_DAYS,
        (timestampMs) => new Date(timestampMs).toISOString().slice(0, 10),
      ),
      activityTrendHourly: buildDashboardBucketedActivityTrend(
        events,
        now,
        DASHBOARD_HOUR_MS,
        DASHBOARD_TREND_HOURS,
        (timestampMs) => new Date(timestampMs).toISOString(),
      ),
    };
  }

  const generatedAt = parseDashboardTimestamp(summary.generatedAt);
  const summaryEvents = generatedAt === null ? [] : events;
  const recentCutoff = now - DASHBOARD_DAY_MS;
  const deltaEvents = generatedAt === null
    ? []
    : summaryEvents.filter((event) => {
      const timestamp = parseDashboardTimestamp(event.timestamp);
      return timestamp !== null && timestamp > generatedAt && timestamp <= now;
    });
  const deltaRecentToolCalls = deltaEvents.filter(
    (event) => event.kind === "tool" && isRecentDashboardTimestamp(event.timestamp, recentCutoff),
  ).length;
  return {
    promptCount: summary.promptCount + deltaEvents.filter(
      (event) => event.kind === "prompt" && isRecentDashboardTimestamp(event.timestamp, recentCutoff),
    ).length,
    recentToolCallCount: summary.recentToolCallCount + deltaRecentToolCalls,
    toolCallCount: summary.toolCallCount + deltaEvents.filter((event) => event.kind === "tool").length,
    activityTrend: mergeDashboardActivityTrend(
      summary.activityTrend,
      deltaEvents,
      generatedAt ?? Number.POSITIVE_INFINITY,
      now,
      DASHBOARD_DAY_MS,
      (timestampMs) => new Date(timestampMs).toISOString().slice(0, 10),
    ),
    activityTrendHourly: mergeDashboardActivityTrend(
      summary.activityTrendHourly,
      deltaEvents,
      generatedAt ?? Number.POSITIVE_INFINITY,
      now,
      DASHBOARD_HOUR_MS,
      (timestampMs) => new Date(timestampMs).toISOString(),
    ),
  };
}

function mergeDashboardActivityTrendPoints(
  points: DashboardActivityTrendPoint[],
  additions: DashboardActivityTrendPoint[],
) {
  const merged = points.map((point) => ({ ...point }));
  const pointsByDate = new Map(merged.map((point) => [point.date, point]));
  for (const addition of additions) {
    const point = pointsByDate.get(addition.date);
    if (point) {
      point.promptCount += addition.promptCount;
      point.toolCallCount += addition.toolCallCount;
      continue;
    }
    const next = { ...addition };
    merged.push(next);
    pointsByDate.set(next.date, next);
  }
  return merged.sort((left, right) => left.date.localeCompare(right.date));
}

function resolveDashboardCurrentHelmKey(input: Pick<
  DashboardInput,
  "activeHelm" | "currentHelmKey" | "daemonHost" | "daemonPort"
>) {
  return input.currentHelmKey ?? daemonProfileKey(
    input.activeHelm?.host ?? input.daemonHost,
    String(input.activeHelm?.port ?? input.daemonPort),
  );
}

function resolveDashboardInventories(input: Pick<
  DashboardInput,
  | "activeHelm"
  | "agentConnectionInventory"
  | "agents"
  | "activitySummary"
  | "currentHelmKey"
  | "daemonHost"
  | "daemonPort"
  | "helmInventories"
  | "sessions"
  | "statuses"
>) {
  const inventories = new Map(Object.entries(input.helmInventories ?? {}));
  const currentHelmKey = resolveDashboardCurrentHelmKey(input);
  const currentInventory = inventories.get(currentHelmKey) ?? {};
  inventories.set(currentHelmKey, {
    ...currentInventory,
    agents: input.agents,
    agentConnections: input.agentConnectionInventory ?? [],
    sessions: input.sessions,
    statuses: input.statuses,
    activitySummary: input.activitySummary ?? currentInventory.activitySummary,
  });
  return inventories;
}

function resolveDashboardHelmKey(value: Partial<HelmSummary> & Record<string, unknown>) {
  const host = dashboardText(value.host);
  const port = typeof value.port === "number"
    ? String(value.port)
    : dashboardText(value.port);
  return host && port ? daemonProfileKey(host, port) : dashboardText(value.id);
}

function resolveDashboardHelmKeys(input: DashboardInput) {
  const configuredKeys = new Set<string>();
  for (const helm of input.configuredHelms ?? []) {
    const key = resolveDashboardHelmKey(helm);
    if (key) configuredKeys.add(key);
  }
  if (configuredKeys.size > 0) {
    return configuredKeys;
  }

  const keys = new Set<string>();
  for (const helm of input.helms ?? []) {
    const key = resolveDashboardHelmKey(helm);
    if (key) keys.add(key);
  }
  Object.keys(input.helmConnectionStates ?? {}).forEach((key) => keys.add(key));
  Object.keys(input.helmInventories ?? {}).forEach((key) => keys.add(key));
  keys.add(resolveDashboardCurrentHelmKey(input));
  return keys;
}

function resolveDashboardHelmCounts(input: DashboardInput) {
  const keys = resolveDashboardHelmKeys(input);
  const onlineHelmCount = Array.from(keys).filter((key) =>
    isDashboardHelmConnected(input, key),
  ).length;
  return {
    onlineHelmCount,
    totalHelmCount: keys.size,
  };
}

function resolveDashboardSessionCounts(input: DashboardInput) {
  let runningSessionCount = 0;
  let totalSessionCount = 0;
  for (const inventory of resolveDashboardInventories(input).values()) {
    const sessions = inventory?.sessions ?? [];
    const statuses = inventory?.statuses ?? {};
    totalSessionCount += sessions.length;
    runningSessionCount += sessions.filter((session) =>
      (statuses[session.id] ?? session.status) === "running",
    ).length;
  }
  return { runningSessionCount, totalSessionCount };
}

function mergeDashboardFleetActivityMetrics(
  input: DashboardInput,
  currentMetrics: ReturnType<typeof resolveDashboardActivityMetrics>,
) {
  let promptCount = currentMetrics.promptCount;
  let recentToolCallCount = currentMetrics.recentToolCallCount;
  let toolCallCount = currentMetrics.toolCallCount;
  let activityTrend = currentMetrics.activityTrend;
  let activityTrendHourly = currentMetrics.activityTrendHourly;
  const currentHelmKey = resolveDashboardCurrentHelmKey(input);

  for (const [helmKey, inventory] of resolveDashboardInventories(input)) {
    if (helmKey === currentHelmKey || !inventory?.activitySummary) {
      continue;
    }
    const summary = inventory.activitySummary;
    promptCount += summary.promptCount;
    recentToolCallCount += summary.recentToolCallCount;
    toolCallCount += summary.toolCallCount;
    activityTrend = mergeDashboardActivityTrendPoints(activityTrend, summary.activityTrend);
    activityTrendHourly = mergeDashboardActivityTrendPoints(
      activityTrendHourly,
      summary.activityTrendHourly,
    );
  }

  return {
    promptCount,
    recentToolCallCount,
    toolCallCount,
    activityTrend,
    activityTrendHourly,
  };
}

function buildDashboardBucketedActivityTrend(
  events: DashboardActivityEvent[],
  now: number,
  bucketMs: number,
  bucketCount: number,
  formatDate: (timestampMs: number) => string,
): DashboardActivityTrendPoint[] {
  const currentBucket = Math.floor(now / bucketMs) * bucketMs;
  const startBucket = currentBucket - (bucketCount - 1) * bucketMs;
  const points = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = startBucket + index * bucketMs;
    return {
      date: formatDate(bucketStart),
      promptCount: 0,
      toolCallCount: 0,
    };
  });
  const pointsByBucket = new Map(
    points.map((point, index) => [startBucket + index * bucketMs, point]),
  );

  function increment(timestamp: unknown, field: "promptCount" | "toolCallCount") {
    const timestampMs = parseDashboardTimestamp(timestamp);
    if (timestampMs === null || timestampMs > now) {
      return;
    }
    const bucketStart = Math.floor(timestampMs / bucketMs) * bucketMs;
    const point = pointsByBucket.get(bucketStart);
    if (point) {
      point[field] += 1;
    }
  }

  for (const event of events) {
    increment(event.timestamp, event.kind === "prompt" ? "promptCount" : "toolCallCount");
  }

  return points;
}

export function buildDashboardActivityTrend(
  sessionTimeline: Record<string, SessionTimelineEntry[]> | undefined,
  toolCalls: Record<string, unknown[]>,
  now: number,
  messages?: Record<string, AgentMessage[]>,
): DashboardActivityTrendPoint[] {
  const events = collectDashboardActivityEvents(sessionTimeline, messages, toolCalls);
  return buildDashboardBucketedActivityTrend(
    events,
    now,
    DASHBOARD_DAY_MS,
    DASHBOARD_TREND_DAYS,
    (timestampMs) => new Date(timestampMs).toISOString().slice(0, 10),
  );
}

export function buildDashboardHourlyActivityTrend(
  sessionTimeline: Record<string, SessionTimelineEntry[]> | undefined,
  toolCalls: Record<string, unknown[]>,
  now: number,
  messages?: Record<string, AgentMessage[]>,
): DashboardActivityTrendPoint[] {
  const events = collectDashboardActivityEvents(sessionTimeline, messages, toolCalls);
  return buildDashboardBucketedActivityTrend(
    events,
    now,
    DASHBOARD_HOUR_MS,
    DASHBOARD_TREND_HOURS,
    (timestampMs) => new Date(timestampMs).toISOString(),
  );
}

function summarizeDashboardPlan(plan: AgentPlan | undefined): DashboardPlanSummary | null {
  if (!plan?.entries.length) {
    return null;
  }
  const completed = plan.entries.filter((entry) => entry.status === "completed").length;
  const total = plan.entries.length;
  return {
    completed,
    total,
    label: completed === total ? `${completed}/${total} 已完成` : `${completed}/${total} 进行中`,
  };
}

export function resolveDashboardApprovalDecision(
  options: PermissionRequestOption[] | undefined,
): PermissionDecision {
  if (!Array.isArray(options)) {
    return "allow";
  }
  return options.find((option) => option.decision === "allow")?.decision
    ?? options.find((option) => option.decision.startsWith("allow"))?.decision
    ?? "allow";
}

export function resolveDashboardApprovalDecisions(): PermissionDecision[] {
  return [...DASHBOARD_APPROVAL_DECISIONS];
}

function buildDashboardApprovalRow(
  item: any,
  sessionsById: Map<string, SessionSummary>,
  resolveDisplaySessionTitle: (session: SessionSummary) => string,
) {
  const request = item.request ?? {};
  const sessionId = item.sessionId ?? request.sessionId;
  const session = sessionId ? sessionsById.get(sessionId) : undefined;
  const command = dashboardText(request.command)
    ?? dashboardText(request.toolName)
    ?? dashboardText(request.kind)
    ?? dashboardText(request.type)
    ?? "权限请求";
  const commandDisplay = resolvePermissionCommandDisplay(command);
  return {
    id: String(item.id ?? request.id ?? item.requestId ?? item.createdAt),
    sessionId: dashboardText(sessionId) ?? undefined,
    kind: commandDisplay.title,
    target: dashboardText(request.reason)
      ?? commandDisplay.detail
      ?? dashboardText(request.description)
      ?? dashboardText(request.path)
      ?? dashboardText(request.url)
      ?? "权限请求",
    allowDecision: resolveDashboardApprovalDecision(request.options),
    decisions: resolveDashboardApprovalDecisions(),
    agentName: session?.agentName ?? request.agentName ?? request.agentId,
    projectName: session?.projectName,
    worktreeName: session?.worktreeName,
    sessionName: session
      ? resolveDisplaySessionTitle(session)
      : dashboardText(sessionId) ?? "未知会话",
    resolving: Boolean(item.resolving) || item.status === "resolving",
    status: item.status ?? (item.resolving ? "resolving" : "pending"),
    decision: item.decision,
    createdAt: item.createdAt ?? item.updatedAt,
    updatedAt: item.updatedAt ?? item.createdAt,
  };
}

const DASHBOARD_ACTIVE_ACP_CONNECTION_STATUSES = new Set([
  "starting",
  "ready",
  "idle",
]);

function resolveDashboardObjectField(value: unknown, field: string) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return dashboardText((value as Record<string, unknown>)[field]);
}

function resolveDashboardAcpCounts(input: Pick<
  DashboardInput,
  | "agents"
  | "agentConnectionInventory"
  | "activeHelm"
  | "activitySummary"
  | "connection"
  | "currentHelmKey"
  | "daemonHost"
  | "daemonPort"
  | "helmConnectionStates"
  | "helmInventories"
  | "sessions"
  | "statuses"
>) {
  const scopedInventories = resolveDashboardInventories(input);

  const configuredAgentKeys = new Set<string>();
  const runningAgentKeys = new Set<string>();
  for (const [helmKey, inventory] of scopedInventories) {
    if (!inventory) {
      continue;
    }
    const agents = inventory.agents ?? [];
    const connections = inventory.agentConnections ?? [];
    for (const agent of agents) {
      const providerId = resolveDashboardObjectField(agent, "id");
      if (providerId) {
        configuredAgentKeys.add(`${helmKey}:${providerId}`);
      }
    }
    if (!isDashboardHelmConnected(input, helmKey)) {
      continue;
    }
    for (const connection of connections) {
      const providerId = resolveDashboardObjectField(connection, "providerId");
      if (
        providerId &&
        DASHBOARD_ACTIVE_ACP_CONNECTION_STATUSES.has(connection.status ?? "")
      ) {
        runningAgentKeys.add(`${helmKey}:${providerId}`);
      }
    }
  }

  return {
    runningAcpCount: Array.from(runningAgentKeys).filter((key) => configuredAgentKeys.has(key)).length,
    totalAcpCount: configuredAgentKeys.size,
  };
}

function isDashboardHelmConnected(
  input: Pick<
    DashboardInput,
    | "activeHelm"
    | "connection"
    | "currentHelmKey"
    | "daemonHost"
    | "daemonPort"
    | "helmConnectionStates"
  >,
  helmKey: string,
) {
  const state = input.helmConnectionStates?.[helmKey];
  if (state) {
    return state === "connected";
  }
  return helmKey === resolveDashboardCurrentHelmKey(input) && input.connection === "connected";
}

export function buildDashboardViewModel(input: DashboardInput) {
  const now = input.now ?? Date.now();
  const currentHelmKey = resolveDashboardCurrentHelmKey(input);
  const dashboardInventories = resolveDashboardInventories(input);
  const activeHelmLabel = input.activeHelm
    ? `${input.activeHelm.name ?? "Local Helm"} · ${input.activeHelm.host ?? input.defaultDaemonHost}:${input.activeHelm.port ?? input.defaultDaemonPort}`
    : `${input.daemonHost || input.defaultDaemonHost}:${input.daemonPort || input.defaultDaemonPort}`;

  const helmCatalog = input.configuredHelms?.length ? input.configuredHelms : input.helms ?? [];
  const helms = helmCatalog.map((helm) => {
    const helmKey = resolveDashboardHelmKey(helm) ?? currentHelmKey;
    const inventory = dashboardInventories.get(helmKey);
    const connected = isDashboardHelmConnected(input, helmKey);
    return {
      id: String(helm.id ?? `${helm.host}:${helm.port}`),
      name: String(helm.name ?? "Local Helm"),
      endpoint: `${helm.host ?? input.defaultDaemonHost}:${helm.port ?? input.defaultDaemonPort}`,
      agentCount: Number(helm.agentCount ?? helm.agentsCount ?? inventory?.agents?.length ?? input.agents.length),
      projectCount: Number(helm.projectCount ?? helm.projectsCount ?? input.projects.length),
      sessionCount: Number(helm.sessionCount ?? helm.sessions ?? inventory?.sessions?.length ?? input.sessions.length),
      status: connected ? "active" as const : "idle" as const,
    };
  });
  const { runningAcpCount, totalAcpCount } = resolveDashboardAcpCounts(input);
  const { onlineHelmCount, totalHelmCount } = resolveDashboardHelmCounts(input);
  const { runningSessionCount, totalSessionCount } = resolveDashboardSessionCounts(input);

  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const approvals = Object.values(input.approvalItemsById ?? {}).map((item) =>
    buildDashboardApprovalRow(item, sessionsById, input.resolveDisplaySessionTitle)
  );
  const approvalHistory = (input.approvalHistory ?? []).map((item) => {
    const activeItem = input.approvalItemsById[item.id];
    const projectedItem = activeItem?.sessionId === item.sessionId
      && (item.status === "pending" || item.status === "resolving")
      ? { ...item, status: activeItem.resolving ? "resolving" : "pending" }
      : item;
    return {
      ...buildDashboardApprovalRow(
        projectedItem,
        sessionsById,
        input.resolveDisplaySessionTitle,
      ),
      id: JSON.stringify([item.sessionId, item.runtimeInstanceId, item.id]),
    };
  });

  const activityEvents = collectDashboardActivityEvents(
    input.sessionTimeline,
    input.messages,
    input.toolCalls ?? {},
  );
  const activityMetrics = mergeDashboardFleetActivityMetrics(
    input,
    resolveDashboardActivityMetrics(
      input.activitySummary ?? dashboardInventories.get(currentHelmKey)?.activitySummary,
      activityEvents,
      now,
    ),
  );
  const { toolCallCount, promptCount, recentToolCallCount } = activityMetrics;
  const sessions = input.sessions.map((session) => ({
    id: session.id,
    title: input.resolveDisplaySessionTitle(session),
    projectId: session.projectId,
    projectName: session.projectName,
    worktreeName: session.worktreeName,
    cwd: session.cwd,
    helmId: session.helmId,
    helmKey: currentHelmKey,
    agentId: session.agentId,
    agentName: session.agentName,
    runtimeSessionId: session.runtimeSessionId ?? session.resume?.runtimeSessionId,
    lastMessagePreview: session.lastMessagePreview,
    status: input.statuses?.[session.id] ?? session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    selected: session.id === input.selectedSessionId,
    planSummary: summarizeDashboardPlan(input.sessionPlans?.[session.id]) ?? undefined,
  }));
  const preparations = (input.preparations ?? []).map((preparation) => ({
    id: preparation.id,
    preparationId: preparation.id,
    title: preparation.title ?? preparation.content.slice(0, 80),
    content: preparation.content,
    projectId: preparation.projectId,
    projectName: (input.projects as Array<{ id?: string; name?: string }>).find(
      (project) => project.id === preparation.projectId,
    )?.name,
    cwd: preparation.cwd,
    worktreeName: preparation.cwd?.split(/[\\/]/u).filter(Boolean).at(-1),
    helmKey: currentHelmKey,
    agentId: preparation.agentId,
    agentName: preparation.agentId,
    status: undefined,
    createdAt: preparation.createdAt,
    updatedAt: preparation.updatedAt,
    revision: preparation.revision,
  }));
  const planSessionCount = sessions.filter((session) => session.planSummary).length;
  const completedPlanSessionCount = sessions.filter(
    (session) =>
      session.planSummary &&
      session.planSummary.completed === session.planSummary.total,
  ).length;
  return {
    activeHelmLabel,
    onlineHelmCount,
    totalHelmCount,
    runningAcpCount,
    totalAcpCount,
    runningSessionCount,
    totalSessionCount,
    pendingApprovalCount: approvals.length,
    planSessionCount,
    completedPlanSessionCount,
    toolCallCount,
    promptCount,
    recentToolCallCount,
    activityTrend: activityMetrics.activityTrend,
    activityTrendHourly: activityMetrics.activityTrendHourly,
    sessions,
    preparations,
    helms,
    approvals,
    approvalHistory,
    notifications: (input.notifications ?? []).map((notification) => {
      const session = notification.sessionId ? sessionsById.get(notification.sessionId) : undefined;
      return {
        ...notification,
        sessionName: session
          ? input.resolveDisplaySessionTitle(session)
          : notification.sessionId,
      };
    }),
  };
}
