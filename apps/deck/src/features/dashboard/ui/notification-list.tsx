import { Icon, StatusDot } from "../../../shared/ui";
import type { DashboardNotification } from "../orchestration/dashboard-view-model";

type DashboardNotificationListProps = {
  notifications: DashboardNotification[];
  onOpenSession?: (sessionId: string) => void;
  onClear?: () => void;
  embedded?: boolean;
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

function NotificationRow({
  notification,
  onOpenSession,
}: {
  notification: DashboardNotification;
  onOpenSession?: (sessionId: string) => void;
}) {
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
      <span className="min-w-0 break-words whitespace-pre-wrap text-section text-foreground" title={notification.message}>
        {notification.message}
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
      <button
        type="button"
        className={`${NOTIFICATION_GRID_COLUMNS} relative w-full items-center px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken`}
        aria-label={formatNotificationAriaLabel(notification)}
        title="打开会话"
        onClick={() => onOpenSession(notification.sessionId!)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`${NOTIFICATION_GRID_COLUMNS} items-center px-3 py-2.5`} aria-label={formatNotificationAriaLabel(notification)}>
      {content}
    </div>
  );
}

export function DashboardNotificationList({
  notifications,
  onOpenSession,
  onClear,
  embedded = false,
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
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={`${NOTIFICATION_GRID_COLUMNS} border-b border-border-ghost px-3 py-2 font-mono text-meta uppercase tracking-wider text-muted-foreground`}>
            <span>级别</span>
            <span>通知</span>
            <span>来源</span>
            <span>Conversation</span>
            <span>错误码</span>
          </div>
          {notifications.length > 0 ? (
            <ul className="divide-y divide-border-ghost">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <NotificationRow notification={notification} onOpenSession={onOpenSession} />
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
