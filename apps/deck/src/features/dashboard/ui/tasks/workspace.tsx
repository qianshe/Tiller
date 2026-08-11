import {
  AlertTriangle,
  CircleDashed,
  ChevronRight,
  LayoutPanelTop,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../../shared/ui";
import { cn } from "../../../../shared/utils/cn";
import type { DashboardActivitySession } from "../activity/stream";
import {
  resolveTaskBoardColumn,
  TASK_BOARD_COLUMNS,
  type TaskBoardColumnId,
} from "./board-model";

type DashboardTaskWorkspaceProps = {
  sessions: DashboardActivitySession[];
  preparations?: DashboardActivitySession[];
  onOpenSession?: (sessionId: string) => void;
  onConfigureReadySession?: (session: DashboardActivitySession) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  defaultView?: "panel" | "table";
};

type TaskGroup = {
  id: TaskBoardColumnId;
  label: string;
  tone: "primary" | "idle" | "active" | "danger";
  sessions: DashboardActivitySession[];
};

function groupTaskSessions(
  sessions: DashboardActivitySession[],
  preparations: DashboardActivitySession[] = [],
): TaskGroup[] {
  const groups: TaskGroup[] = TASK_BOARD_COLUMNS.map((column) => ({ ...column, sessions: [] }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  [...sessions, ...preparations].forEach((session) => {
    groupById.get(resolveTaskBoardColumn(session))?.sessions.push(session);
  });
  return groups;
}

const TASK_COLUMN_ICONS: Record<TaskBoardColumnId, LucideIcon> = {
  ready: CircleDashed,
  running: PlayCircle,
  attention: AlertTriangle,
  idle: PauseCircle,
};

function resolveTaskStatus(session: DashboardActivitySession) {
  const column = resolveTaskBoardColumn(session);
  const definition = TASK_BOARD_COLUMNS.find((item) => item.id === column)!;
  const badge = column === "attention"
    ? session.status === "waiting_for_permission" ? "warning" as const : "destructive" as const
    : column === "running" ? "default" as const
      : column === "ready" ? "outline" as const
        : "secondary" as const;
  return { label: definition.label, tone: definition.tone, badge };
}

function parseTimestamp(value?: string, fallback = 0) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function formatDateTime(value?: string) {
  const timestamp = parseTimestamp(value, Number.NaN);
  if (!Number.isFinite(timestamp)) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatProjectBranch(session: DashboardActivitySession) {
  return [session.projectName, session.worktreeName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" / ") || "未关联项目";
}

function TaskOpenButton({
  session,
  children,
  className,
  onOpenSession,
  onConfigureReadySession,
}: {
  session: DashboardActivitySession;
  children: ReactNode;
  className?: string;
  onOpenSession?: (sessionId: string) => void;
  onConfigureReadySession?: (session: DashboardActivitySession) => void;
}) {
  const isReady = resolveTaskBoardColumn(session) === "ready";
  const onClick = isReady
    ? onConfigureReadySession
      ? () => onConfigureReadySession(session)
      : undefined
    : onOpenSession
      ? () => onOpenSession(session.id)
      : undefined;
  if (!onClick) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={isReady ? `配置并开始任务 ${session.title}` : `打开任务 ${session.title}`}
    >
      {children}
    </button>
  );
}

function TaskPanelView({
  sessions,
  onOpenSession,
  onConfigureReadySession,
}: {
  sessions: DashboardActivitySession[];
  onOpenSession?: (sessionId: string) => void;
  onConfigureReadySession?: (session: DashboardActivitySession) => void;
}) {
  const groups = groupTaskSessions(sessions);
  const [dragOverRunning, setDragOverRunning] = useState(false);

  function readDraggedSessionId(event: DragEvent<HTMLElement>) {
    return (
      event.dataTransfer.getData("application/x-tiller-ready-session") ||
      event.dataTransfer.getData("text/plain")
    );
  }

  function isReadySessionDrag(event: DragEvent<HTMLElement>) {
    return (
      event.dataTransfer.types.includes("application/x-tiller-ready-session") ||
      event.dataTransfer.types.includes("text/plain")
    );
  }

  function handleReadyDragStart(event: DragEvent<HTMLLIElement>, session: DashboardActivitySession) {
    if (resolveTaskBoardColumn(session) !== "ready" || !onConfigureReadySession) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-tiller-ready-session", session.id);
    event.dataTransfer.setData("text/plain", session.id);
  }

  function handleRunningDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOverRunning(false);
    const sessionId = readDraggedSessionId(event);
    const session = sessions.find((item) => item.id === sessionId);
    if (session && resolveTaskBoardColumn(session) === "ready") {
      onConfigureReadySession?.(session);
    }
  }

  return (
    <div className="max-w-full overflow-x-auto pb-1" data-task-view="panel">
      <div className="grid min-w-[900px] grid-cols-4 gap-3">
        {groups.map((group) => {
          const ColumnIcon = TASK_COLUMN_ICONS[group.id];
          return (
            <section
              key={group.id}
              className={cn(
                "wb-pane min-w-0 overflow-hidden",
                group.id === "running" && dragOverRunning && "ring-2 ring-primary/50",
              )}
              data-task-column={group.id}
              data-task-drop-target={group.id === "running" ? "running" : undefined}
              aria-labelledby={`task-group-${group.id}`}
              onDragOver={
                group.id === "running" && onConfigureReadySession
                  ? (event) => {
                      if (!isReadySessionDrag(event)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverRunning(true);
                    }
                  : undefined
              }
              onDragLeave={
                group.id === "running" && onConfigureReadySession
                  ? () => setDragOverRunning(false)
                  : undefined
              }
              onDrop={
                group.id === "running" && onConfigureReadySession
                  ? handleRunningDrop
                  : undefined
              }
            >
              <div className="wb-pane-head min-h-10 px-3">
                <StatusDot tone={group.tone} size={6} pulse={group.id === "running"} />
                <ColumnIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span id={`task-group-${group.id}`} className="wb-pane-head-title">{group.label}</span>
                <span className="ml-auto font-mono text-meta tabular text-muted-foreground">{group.sessions.length}</span>
              </div>
              {group.sessions.length > 0 ? (
                <ul className="divide-y divide-border-ghost">
                  {group.sessions.map((session) => {
                    const status = resolveTaskStatus(session);
                    return (
                      <li
                        key={session.id}
                        draggable={
                          resolveTaskBoardColumn(session) === "ready" &&
                          Boolean(onConfigureReadySession)
                        }
                        data-task-draggable={
                          resolveTaskBoardColumn(session) === "ready" ? "ready" : undefined
                        }
                        onDragStart={(event) => handleReadyDragStart(event, session)}
                      >
                        <TaskOpenButton
                          session={session}
                          onOpenSession={onOpenSession}
                          onConfigureReadySession={onConfigureReadySession}
                          className={cn(
                            "grid w-full min-w-0 gap-2 px-3 py-3 text-left transition-colors hover:bg-surface-sunken",
                          )}
                        >
                          <span className="flex min-w-0 items-start gap-2">
                            <span className="min-w-0 flex-1 truncate text-section font-medium">{session.title}</span>
                            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          </span>
                          <span className="truncate font-mono text-meta tabular text-muted-foreground">
                            {formatProjectBranch(session)}
                          </span>
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge variant={status.badge} className="max-w-[55%] truncate px-2 py-0.5">
                              {status.label}
                            </Badge>
                            <span className="ml-auto truncate font-mono text-meta text-muted-foreground">
                              {session.agentName ?? session.agentId ?? "未分配"}
                            </span>
                          </span>
                        </TaskOpenButton>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="px-3 py-6 text-center font-mono text-meta text-muted-foreground">
                  暂无任务
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskActionMenu({
  session,
  onConfigureReady,
  onRename,
  onDelete,
}: {
  session: DashboardActivitySession;
  onConfigureReady?: (session: DashboardActivitySession) => void;
  onRename: (session: DashboardActivitySession) => void;
  onDelete: (session: DashboardActivitySession) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`打开任务 ${session.title} 的操作菜单`}
          title="任务操作"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel>任务操作</DropdownMenuLabel>
        {resolveTaskBoardColumn(session) === "ready" && onConfigureReady ? (
          <DropdownMenuItem onSelect={() => onConfigureReady(session)}>
            <PlayCircle className="mr-2 size-3.5" aria-hidden="true" />
            配置并开始
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onRename(session)}>
          <Pencil className="mr-2 size-3.5" aria-hidden="true" />
          重命名
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onDelete(session)}
        >
          <Trash2 className="mr-2 size-3.5" aria-hidden="true" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskTableView({
  sessions,
  selectedSessionIds,
  onOpenSession,
  onConfigureReadySession,
  onRename,
  onDelete,
  onToggleSession,
  onToggleAll,
}: {
  sessions: DashboardActivitySession[];
  selectedSessionIds: Set<string>;
  onOpenSession?: (sessionId: string) => void;
  onConfigureReadySession?: (session: DashboardActivitySession) => void;
  onRename: (session: DashboardActivitySession) => void;
  onDelete: (session: DashboardActivitySession) => void;
  onToggleSession: (sessionId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const allSelected = sessions.length > 0 && sessions.every((session) => selectedSessionIds.has(session.id));
  const partiallySelected = !allSelected && sessions.some((session) => selectedSessionIds.has(session.id));

  return (
    <section className="wb-pane min-w-0 overflow-hidden" data-task-view="table" aria-label="任务表格">
      <Table className="min-w-[900px]">
          <TableHeader className="bg-surface-sunken/40">
            <TableRow className="border-border-ghost/60 hover:bg-transparent">
              <TableHead className="w-10 px-3">
                <Checkbox
                  aria-label="全选任务"
                  checked={partiallySelected ? "indeterminate" : allSelected}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </TableHead>
              <TableHead className="min-w-48 px-3 text-meta">任务</TableHead>
              <TableHead className="min-w-40 px-3 text-meta">项目 / 分支</TableHead>
              <TableHead className="min-w-24 px-3 text-meta">Agent</TableHead>
              <TableHead className="min-w-24 px-3 text-meta">计划</TableHead>
              <TableHead className="min-w-20 px-3 text-meta">状态</TableHead>
              <TableHead className="min-w-28 px-3 text-right text-meta">更新时间</TableHead>
              <TableHead className="sticky right-0 z-10 w-12 bg-surface-sunken/40 px-2 text-right text-meta"><span className="sr-only">操作</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-border-ghost/60">
            {sessions.length > 0 ? sessions.map((session) => {
              const status = resolveTaskStatus(session);
              const selected = selectedSessionIds.has(session.id);
              const isReady = resolveTaskBoardColumn(session) === "ready";
              return (
                <TableRow key={session.id} data-state={selected ? "selected" : undefined}>
                  <TableCell className="w-10 px-3 py-2.5">
                    <Checkbox
                      aria-label={`选择任务 ${session.title}`}
                      checked={selected}
                      onCheckedChange={(checked) => onToggleSession(session.id, checked === true)}
                    />
                  </TableCell>
                  <TableCell className="max-w-48 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto min-w-0 max-w-full justify-start px-0 py-0 text-left font-medium hover:bg-transparent"
                        disabled={isReady ? !onConfigureReadySession : !onOpenSession}
                        onClick={() => {
                          if (isReady) {
                            onConfigureReadySession?.(session);
                          } else {
                            onOpenSession?.(session.id);
                          }
                        }}
                      >
                        <span className="truncate">{session.title}</span>
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-64 truncate px-3 py-2.5 font-mono text-meta text-muted-foreground">
                    {formatProjectBranch(session)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <span className={cn("text-meta", !session.agentName && "text-muted-foreground")}>
                      {session.agentName ?? session.agentId ?? "未分配"}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-meta tabular text-muted-foreground">
                    {session.planSummary?.label ?? "未规划"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <Badge variant={status.badge} className="px-2 py-0.5">{status.label}</Badge>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right font-mono text-meta tabular text-muted-foreground">
                    {formatDateTime(session.updatedAt)}
                  </TableCell>
                  <TableCell className="sticky right-0 z-10 w-12 bg-surface/95 px-2 py-2.5 text-right">
                    <TaskActionMenu
                      session={session}
                      onConfigureReady={onConfigureReadySession}
                      onRename={onRename}
                      onDelete={onDelete}
                    />
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">暂无任务</TableCell>
              </TableRow>
            )}
          </TableBody>
      </Table>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border-ghost/60 px-3 py-2 font-mono text-meta tabular text-muted-foreground">
        <span>{selectedSessionIds.size > 0 ? `已选择 ${selectedSessionIds.size} 项` : `共 ${sessions.length} 项`}</span>
        <span>{sessions.length > 0 ? `显示 ${sessions.length} 项` : "暂无任务"}</span>
      </div>
    </section>
  );
}

function TaskRenameDialog({
  session,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  session: DashboardActivitySession | null;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(session)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>重命名任务</DialogTitle>
          <DialogDescription>修改任务名称后会同步到当前 Helm。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="dashboard-task-title">任务名称</Label>
            <Input
              id="dashboard-task-title"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              autoFocus
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={!value.trim()}>保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDeleteDialog({
  session,
  onClose,
  onConfirm,
}: {
  session: DashboardActivitySession | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(session)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>删除任务？</DialogTitle>
          <DialogDescription>将清理本地记录，并尝试删除 Agent 侧的远端会话。</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 rounded-md bg-surface-sunken p-3">
          <strong className="block truncate text-section font-medium">{session?.title}</strong>
          <span className="mt-1 block truncate font-mono text-meta text-muted-foreground">
            {session ? formatProjectBranch(session) : ""}
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>取消</Button>
          <Button variant="destructive" type="button" onClick={onConfirm}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DashboardTaskWorkspace({
  sessions,
  preparations = [],
  onOpenSession,
  onConfigureReadySession,
  onRenameSession,
  onDeleteSession,
  defaultView = "panel",
}: DashboardTaskWorkspaceProps) {
  const taskItems = [...sessions, ...preparations];
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [renameSession, setRenameSession] = useState<DashboardActivitySession | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSession, setDeleteSession] = useState<DashboardActivitySession | null>(null);

  const activeCount = sessions.filter((session) => resolveTaskBoardColumn(session) === "running").length;
  const attentionCount = sessions.filter((session) => resolveTaskBoardColumn(session) === "attention").length;
  const unassignedCount = preparations.length;

  function toggleSession(sessionId: string, checked: boolean) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (checked) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      for (const session of sessions) {
        if (checked) next.add(session.id);
        else next.delete(session.id);
      }
      return next;
    });
  }

  function openRename(session: DashboardActivitySession) {
    setRenameSession(session);
    setRenameValue(session.title);
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = renameValue.trim();
    if (!renameSession || !title) return;
    onRenameSession?.(renameSession.id, title);
    setRenameSession(null);
  }

  function confirmDelete() {
    if (!deleteSession) return;
    onDeleteSession?.(deleteSession.id);
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      next.delete(deleteSession.id);
      return next;
    });
    setDeleteSession(null);
  }

  return (
    <>
      <Tabs defaultValue={defaultView} className="min-h-0 min-w-0" aria-label="任务视图">
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-meta tabular text-muted-foreground">
            <span>{taskItems.length} 个任务</span>
            <span aria-hidden="true">·</span>
            <span>{activeCount} 进行中</span>
            {attentionCount > 0 ? <><span aria-hidden="true">·</span><span>{attentionCount} 待处理</span></> : null}
            {unassignedCount > 0 ? <><span aria-hidden="true">·</span><span>{unassignedCount} 未分配</span></> : null}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <TabsList size="sm" aria-label="切换任务视图">
              <TabsTrigger value="panel" size="sm" className="gap-1.5"><LayoutPanelTop className="size-3.5" />面板</TabsTrigger>
              <TabsTrigger value="table" size="sm" className="gap-1.5"><Table2 className="size-3.5" />表格</TabsTrigger>
            </TabsList>
          </div>
        </div>
        <TabsContent value="panel" className="mt-0">
          <TaskPanelView
            sessions={taskItems}
            onOpenSession={onOpenSession}
            onConfigureReadySession={onConfigureReadySession}
          />
        </TabsContent>
        <TabsContent value="table" className="mt-0">
          <TaskTableView
            sessions={taskItems}
            selectedSessionIds={selectedSessionIds}
            onOpenSession={onOpenSession}
            onConfigureReadySession={onConfigureReadySession}
            onRename={openRename}
            onDelete={setDeleteSession}
            onToggleSession={toggleSession}
            onToggleAll={toggleAll}
          />
        </TabsContent>
      </Tabs>
      <TaskRenameDialog
        session={renameSession}
        value={renameValue}
        onChange={setRenameValue}
        onClose={() => setRenameSession(null)}
        onSubmit={submitRename}
      />
      <TaskDeleteDialog
        session={deleteSession}
        onClose={() => setDeleteSession(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
