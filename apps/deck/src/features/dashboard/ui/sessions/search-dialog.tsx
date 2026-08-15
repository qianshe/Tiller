import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  StatusDot,
} from "../../../../shared/ui";

export type DashboardSessionSearchItem = {
  id: string;
  title: string;
  projectName?: string | null;
  worktreeName?: string | null;
  agentName?: string | null;
  status?: string;
  updatedAt?: string;
};

export type DashboardSessionSearchDialogProps = {
  open: boolean;
  sessions: DashboardSessionSearchItem[];
  onOpenChange: (open: boolean) => void;
  onOpenSession?: (sessionId: string) => void;
};

export function filterDashboardSessions(
  sessions: DashboardSessionSearchItem[],
  query: string,
): DashboardSessionSearchItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return sessions;
  }
  return sessions.filter((session) => session.title.toLocaleLowerCase().includes(normalizedQuery));
}

function resolveSessionTone(status?: string): "active" | "idle" | "warning" | "danger" {
  switch (status) {
    case "running":
      return "active";
    case "waiting_for_permission":
      return "warning";
    case "error":
      return "danger";
    default:
      return "idle";
  }
}

function resolveSessionStatus(status?: string) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "waiting_for_permission":
      return "待审批";
    case "error":
      return "错误";
    case "cancelled":
      return "已取消";
    case "completed":
      return "已完成";
    default:
      return "空闲";
  }
}

function formatSessionScope(session: DashboardSessionSearchItem) {
  return [session.projectName, session.worktreeName, session.agentName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

export function DashboardSessionSearchDialog({
  open,
  sessions,
  onOpenChange,
  onOpenSession,
}: DashboardSessionSearchDialogProps) {
  const [query, setQuery] = useState("");
  const results = filterDashboardSessions(sessions, query);

  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border-ghost p-4 pb-3">
          <DialogTitle className="text-section font-semibold">搜索会话</DialogTitle>
          <DialogDescription className="sr-only">按会话名称查找并打开已有会话</DialogDescription>
          <div className="relative mt-3">
            <Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按会话名称搜索..."
              aria-label="会话名称"
              className="pl-8"
            />
          </div>
        </DialogHeader>

        <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          {results.length > 0 ? (
            <ul aria-label="会话结果" className="grid gap-1">
              {results.map((session) => {
                const scope = formatSessionScope(session);
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
                      disabled={!onOpenSession}
                      aria-label={`打开会话 ${session.title}`}
                      onClick={() => {
                        onOpenChange(false);
                        onOpenSession?.(session.id);
                      }}
                    >
                      <StatusDot tone={resolveSessionTone(session.status)} size={7} />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-section font-medium text-foreground">{session.title}</span>
                        <span className="truncate font-mono text-meta text-muted-foreground">{scope || session.id}</span>
                      </span>
                      <span className="shrink-0 font-mono text-meta text-muted-foreground">
                        {resolveSessionStatus(session.status)}
                      </span>
                      <Icon name="chevronRight" size={14} className="text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="grid min-h-32 place-items-center px-4 py-8 text-center" role="status">
              <div className="grid gap-1">
                <Icon name="search" size={18} className="mx-auto text-muted-foreground" />
                <span className="text-section font-medium text-foreground">
                  {query.trim() ? "未找到匹配会话" : "暂无会话"}
                </span>
                <span className="font-mono text-meta text-muted-foreground">
                  {query.trim() ? "请尝试其他会话名称" : "创建任务后，会话会显示在这里"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border-ghost px-4 py-2 font-mono text-meta text-muted-foreground">
          {results.length} 个结果
        </div>
      </DialogContent>
    </Dialog>
  );
}
