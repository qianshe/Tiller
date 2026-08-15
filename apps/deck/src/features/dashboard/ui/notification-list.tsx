import { useEffect, useRef, useState } from "react";
import { Icon, StatusDot } from "../../../shared/ui";
import { copyTextToClipboard } from "../../../shared/utils/clipboard";
import type { DashboardNotification } from "../orchestration/view-model";

type DashboardNotificationListProps = {
  notifications: DashboardNotification[];
  onOpenSession?: (sessionId: string) => void;
  onClear?: () => void;
  embedded?: boolean;
  compact?: boolean;
};

const KIND_LABELS: Record<DashboardNotification["kind"], string> = {
  error: "错误",
  warning: "警告",
  info: "信息",
};

const SOURCE_LABELS: Record<string, string> = {
  auth: "认证",
  rpc: "RPC",
  runtime: "运行时",
  session: "会话",
  storage: "存储",
  update: "更新",
};

const NOTIFICATION_GRID_COLUMNS =
  "grid grid-cols-[88px_minmax(240px,1fr)_minmax(92px,0.45fr)_minmax(150px,0.7fr)_minmax(128px,0.55fr)] gap-2";
const NOTIFICATION_ROW_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_32px] items-center gap-1";

type NotificationClipboard = Pick<Clipboard, "writeText">;
type CopyState = "idle" | "copied" | "failed";

function formatNotificationTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "--:--:--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function resolveNotificationTone(kind: DashboardNotification["kind"]) {
  return kind === "error" ? "danger" : kind === "warning" ? "warning" : "primary";
}

function resolveSourceLabel(source?: string) {
  return SOURCE_LABELS[source ?? "runtime"] ?? source ?? "运行时";
}

function formatNotificationAriaLabel(notification: DashboardNotification) {
  return `${KIND_LABELS[notification.kind]}通知: ${notification.message}. 来源 ${resolveSourceLabel(notification.source)}. ${notification.sessionName ? `会话 ${notification.sessionName}.` : "系统通知."}`;
}

type NotificationDetailKey = keyof NonNullable<DashboardNotification["details"]>;

const NOTIFICATION_DETAIL_FIELDS: Array<[NotificationDetailKey, string]> = [
  ["phase", "阶段"],
  ["helmKey", "Helm"],
  ["method", "RPC 方法"],
  ["sessionId", "会话 ID"],
  ["kind", "消息类型"],
  ["updateKind", "更新类型"],
  ["updateId", "更新 ID"],
  ["errorName", "错误类型"],
  ["errorCode", "RPC 错误码"],
  ["errorStack", "错误堆栈"],
  ["componentStack", "组件堆栈"],
];

function formatNotificationDiagnosticSummary(
  details: DashboardNotification["details"],
) {
  if (!details) {
    return "";
  }
  return [
    details.method,
    details.updateKind,
    details.errorName,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function formatNotificationDetailLines(
  details: DashboardNotification["details"],
) {
  if (!details) {
    return [];
  }
  return NOTIFICATION_DETAIL_FIELDS.flatMap(([key, label]) => {
    const value = details[key];
    if (!value) {
      return [];
    }
    return key === "errorStack" || key === "componentStack"
      ? [`${label}:\n${value}`]
      : [`${label}: ${value}`];
  });
}

export function formatNotificationReport(notification: DashboardNotification): string {
  const session = notification.sessionId
    ? notification.sessionName && notification.sessionName !== notification.sessionId
      ? `${notification.sessionName} (${notification.sessionId})`
      : notification.sessionId
    : "系统";
  const detailLines = formatNotificationDetailLines(notification.details);
  return [
    `Tiller ${KIND_LABELS[notification.kind]}通知`,
    `时间: ${notification.createdAt}`,
    `来源: ${notification.source ?? "runtime"}`,
    ...(notification.code ? [`错误码: ${notification.code}`] : []),
    `会话: ${session}`,
    `消息: ${notification.message}`,
    ...(detailLines.length > 0 ? ["诊断信息:", ...detailLines] : []),
  ].join("\n");
}

export async function copyNotificationReport(
  notification: DashboardNotification,
  clipboard: NotificationClipboard | undefined,
): Promise<void> {
  // navigator.clipboard is only available in secure contexts (HTTPS or
  // localhost). Mobile Web often reaches Helm over a LAN IP via plain HTTP,
  // where the async clipboard API is missing; copyTextToClipboard falls back
  // to the execCommand("copy") path so copy keeps working there.
  await copyTextToClipboard(formatNotificationReport(notification), clipboard);
}

function NotificationCopyButton({ notification }: { notification: DashboardNotification }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      globalThis.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const label = copyState === "copied"
    ? "通知已复制"
    : copyState === "failed"
      ? "复制失败"
      : "复制通知";

  async function copyReport() {
    if (resetTimerRef.current !== null) {
      globalThis.clearTimeout(resetTimerRef.current);
    }
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      await copyNotificationReport(notification, clipboard);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    resetTimerRef.current = globalThis.setTimeout(() => {
      setCopyState("idle");
      resetTimerRef.current = null;
    }, 1_600);
  }

  return (
    <button
      type="button"
      className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:text-foreground"
      aria-label={label}
      title={label}
      onClick={() => void copyReport()}
    >
      <Icon name={copyState === "copied" ? "check" : "copy"} size={12} />
    </button>
  );
}

function NotificationRow({
  notification,
  onOpenSession,
  compact = false,
}: {
  notification: DashboardNotification;
  onOpenSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const diagnosticSummary = formatNotificationDiagnosticSummary(notification.details);
  if (compact) {
    const compactContent = (
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={resolveNotificationTone(notification.kind)} size={6} />
          <span className="text-section text-foreground">{KIND_LABELS[notification.kind]}</span>
          <span className="ml-auto shrink-0 font-mono text-meta tabular text-muted-foreground">
            {formatNotificationTime(notification.createdAt)}
          </span>
        </span>
        <span className="break-words text-section text-foreground" title={notification.message}>
          {notification.message}
        </span>
        <span className="truncate font-mono text-meta tabular text-muted-foreground">
          {[resolveSourceLabel(notification.source), notification.sessionName ?? notification.sessionId, notification.code]
            .filter((value): value is string => Boolean(value))
            .join(" · ")}
        </span>
      </span>
    );
    const rowContent = notification.sessionId && onOpenSession ? (
      <button
        type="button"
        className="min-w-0 px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken"
        aria-label={formatNotificationAriaLabel(notification)}
        title="打开会话"
        onClick={() => onOpenSession(notification.sessionId!)}
      >
        {compactContent}
      </button>
    ) : (
      <div className="min-w-0 px-3 py-2.5" aria-label={formatNotificationAriaLabel(notification)}>
        {compactContent}
      </div>
    );
    return (
      <div className={NOTIFICATION_ROW_COLUMNS}>
        {rowContent}
        <NotificationCopyButton notification={notification} />
      </div>
    );
  }
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot tone={resolveNotificationTone(notification.kind)} size={6} />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-section">{KIND_LABELS[notification.kind]}</span>
          <span className="truncate font-mono text-meta tabular text-muted-foreground">
            {formatNotificationTime(notification.createdAt)}
          </span>
        </span>
      </span>
      <span className="grid min-w-0 gap-0.5 text-section text-foreground" title={notification.message}>
        <span className="break-words whitespace-pre-wrap">{notification.message}</span>
        {diagnosticSummary ? (
          <span className="truncate font-mono text-meta tabular text-muted-foreground" title={diagnosticSummary}>
            诊断 · {diagnosticSummary}
          </span>
        ) : null}
      </span>
      <span className="truncate font-mono text-meta tabular text-muted-foreground">
        {resolveSourceLabel(notification.source)}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-meta tabular text-muted-foreground">
        {notification.sessionId ? (
          <>
            <Icon name="message" size={11} className="shrink-0" />
            <span className="truncate">{notification.sessionName ?? notification.sessionId}</span>
          </>
        ) : (
          <span>系统</span>
        )}
      </span>
      <span className="truncate font-mono text-meta tabular text-muted-foreground">
        {notification.code ?? "—"}
      </span>
    </>
  );

  if (notification.sessionId && onOpenSession) {
    return (
      <div className={NOTIFICATION_ROW_COLUMNS}>
        <button
          type="button"
          className={`${NOTIFICATION_GRID_COLUMNS} relative w-full items-center px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken`}
          aria-label={formatNotificationAriaLabel(notification)}
          title="打开会话"
          onClick={() => onOpenSession(notification.sessionId!)}
        >
          {content}
        </button>
        <NotificationCopyButton notification={notification} />
      </div>
    );
  }

  return (
    <div className={NOTIFICATION_ROW_COLUMNS}>
      <div className={`${NOTIFICATION_GRID_COLUMNS} items-center px-3 py-2.5`} aria-label={formatNotificationAriaLabel(notification)}>
        {content}
      </div>
      <NotificationCopyButton notification={notification} />
    </div>
  );
}

export function DashboardNotificationList({
  notifications,
  onOpenSession,
  onClear,
  embedded = false,
  compact = false,
}: DashboardNotificationListProps) {
  return (
    <section
      className={embedded ? "flex min-h-0 flex-1 flex-col" : "wb-pane"}
      role={embedded ? "tabpanel" : undefined}
      aria-label={embedded ? "通知" : undefined}
      aria-labelledby={embedded ? undefined : "dashboard-notifications-title"}
      data-testid="dashboard-notifications"
    >
      {!embedded ? (
        <div className="wb-pane-head min-h-9">
          <span id="dashboard-notifications-title" className="wb-pane-head-title">通知</span>
          <span className="ml-1.5 font-mono text-action font-medium tabular text-muted-foreground">{notifications.length}</span>
          {notifications.length > 0 && onClear ? (
            <button
              type="button"
              className="ml-auto grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
              title="清空通知"
              aria-label="清空通知"
              onClick={onClear}
            >
              <Icon name="trash" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={compact ? "min-w-0 flex-1" : "min-w-0 flex-1 overflow-x-auto"}>
        <div className={compact ? "min-w-0" : "min-w-[800px]"}>
          {!compact ? (
            <div className={`${NOTIFICATION_ROW_COLUMNS} border-b border-border-ghost`}>
              <div className={`${NOTIFICATION_GRID_COLUMNS} px-3 py-2 font-mono text-meta uppercase tracking-wider text-muted-foreground`}>
                <span>级别</span>
                <span>通知</span>
                <span>来源</span>
                <span>Conversation</span>
                <span>错误码</span>
              </div>
              <span aria-hidden="true" />
            </div>
          ) : null}
          {notifications.length > 0 ? (
            <ul className="divide-y divide-border-ghost">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <NotificationRow
                    notification={notification}
                    onOpenSession={onOpenSession}
                    compact={compact}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-4 font-mono text-meta text-muted-foreground">暂无通知</div>
          )}
        </div>
      </div>
    </section>
  );
}
