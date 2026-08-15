import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  ChevronDown,
  Bot,
  Folder,
  LayoutPanelTop,
  ListFilter,
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
  AgentIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

type TaskFilterStatus = "all" | TaskBoardColumnId;

type TaskFilterSelection = {
  status: TaskFilterStatus;
  project: string;
  agent: string;
};

type TaskFilterOption = {
  value: string;
  label: string;
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
  completed: CircleCheck,
  attention: AlertTriangle,
  idle: PauseCircle,
};

const TASK_COLUMN_DOT_TONES: Record<TaskBoardColumnId, "active" | "idle" | "warning" | "danger" | "primary"> = {
  ready: "warning",
  running: "primary",
  completed: "active",
  attention: "danger",
  idle: "idle",
};

const TASK_COLUMN_SURFACES: Record<TaskBoardColumnId, string> = {
  ready: "border-l-2 border-l-warning/45 bg-warning/10",
  running: "border-l-2 border-l-primary/75 bg-primary-soft/35",
  completed: "border-l-2 border-l-success/60 bg-success/10",
  attention: "border-l-2 border-l-destructive/60 bg-destructive/10",
  idle: "border-l-2 border-l-border-ghost bg-surface-sunken/40",
};

const TASK_COLUMN_HEADER_SURFACES: Record<TaskBoardColumnId, string> = {
  ready: "bg-warning/10",
  running: "bg-primary-soft/40",
  completed: "bg-success/10",
  attention: "bg-destructive/10",
  idle: "bg-surface-sunken/45",
};

const TASK_COLUMN_LABEL_COLORS: Record<TaskBoardColumnId, string> = {
  ready: "text-warning",
  running: "text-primary",
  completed: "text-success",
  attention: "text-destructive",
  idle: "text-muted-foreground",
};

const TASK_FILTER_OPTIONS: Array<{ id: TaskFilterStatus; label: string; icon: LucideIcon }> = [
  { id: "all", label: "全部", icon: ListFilter },
  ...TASK_BOARD_COLUMNS.map((column) => ({
    id: column.id,
    label: column.label,
    icon: TASK_COLUMN_ICONS[column.id],
  })),
];

function resolveTaskProjectFilterValue(session: DashboardActivitySession) {
  const value = session.projectId?.trim() || session.projectName?.trim();
  return value ? `project:${value}` : "project:unassigned";
}

function resolveTaskAgentFilterValue(session: DashboardActivitySession) {
  const value = session.agentId?.trim() || session.agentName?.trim();
  return value ? `agent:${value}` : "agent:unassigned";
}

function buildTaskFilterOptions(
  sessions: DashboardActivitySession[],
  resolveValue: (session: DashboardActivitySession) => string,
  resolveLabel: (session: DashboardActivitySession) => string,
  unassignedLabel: string,
): TaskFilterOption[] {
  const options = new Map<string, string>();
  sessions.forEach((session) => {
    const value = resolveValue(session);
    const label = resolveLabel(session);
    options.set(value, label || unassignedLabel);
  });
  return [...options.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function filterTaskSessions(
  sessions: DashboardActivitySession[],
  filter: TaskFilterSelection,
) {
  return sessions.filter((session) => (
    (filter.status === "all" || resolveTaskBoardColumn(session) === filter.status) &&
    (filter.project === "all" || resolveTaskProjectFilterValue(session) === filter.project) &&
    (filter.agent === "all" || resolveTaskAgentFilterValue(session) === filter.agent)
  ));
}

function resolveTaskStatus(session: DashboardActivitySession) {
  const column = resolveTaskBoardColumn(session);
  const definition = TASK_BOARD_COLUMNS.find((item) => item.id === column)!;
  const iconClassName = column === "attention"
    ? session.status === "waiting_for_permission" ? "text-warning" : "text-destructive"
    : column === "running" ? "text-primary"
      : column === "ready" ? "text-warning"
        : column === "completed" ? "text-success"
          : "text-muted-foreground";
  return { label: definition.label, tone: definition.tone, icon: TASK_COLUMN_ICONS[column], iconClassName };
}

function resolveTaskAgent(session: DashboardActivitySession) {
  const name = session.agentName ?? session.agentId;
  return {
    label: name ?? "未分配",
    iconName: name ?? "ACP",
  };
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

function TaskToolbar({
  activeFilter,
  view,
  projectOptions,
  agentOptions,
  onFilterChange,
  onViewChange,
}: {
  activeFilter: TaskFilterSelection;
  view: "panel" | "table";
  projectOptions: TaskFilterOption[];
  agentOptions: TaskFilterOption[];
  onFilterChange: (filter: TaskFilterSelection) => void;
  onViewChange: (view: "panel" | "table") => void;
}) {
  const ViewIcon = view === "panel" ? LayoutPanelTop : Table2;
  const viewLabel = view === "panel" ? "看板" : "表格";
  const activeFilterOption = TASK_FILTER_OPTIONS.find((option) => option.id === activeFilter.status)!;
  const ActiveFilterIcon = activeFilterOption.icon;
  const activeFilterCount = [
    activeFilter.status !== "all",
    activeFilter.project !== "all",
    activeFilter.agent !== "all",
  ].filter(Boolean).length;

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2" data-task-toolbar>
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              aria-label="筛选任务"
              data-task-filter-trigger
            >
              <ActiveFilterIcon className="size-3.5" aria-hidden="true" />
              <span>筛选</span>
              {activeFilterCount > 0 ? <span className="font-mono text-2xs text-primary">· {activeFilterCount}</span> : null}
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" data-task-filter-menu>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-task-filter-category="status">
                <ListFilter className="mr-2 size-3.5" aria-hidden="true" />
                <span>状态</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-36">
                <DropdownMenuRadioGroup value={activeFilter.status} onValueChange={(value) => {
                  if (value === "all" || TASK_BOARD_COLUMNS.some((column) => column.id === value)) {
                    onFilterChange({ ...activeFilter, status: value as TaskFilterStatus });
                  }
                }}>
                  {TASK_FILTER_OPTIONS.map((option) => {
                    const FilterIcon = option.icon;
                    return (
                      <DropdownMenuRadioItem key={option.id} value={option.id} data-task-filter={option.id}>
                        <FilterIcon className="mr-2 size-3.5" aria-hidden="true" />
                        {option.label}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-task-filter-category="project">
                <Folder className="mr-2 size-3.5" aria-hidden="true" />
                <span>项目</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup value={activeFilter.project} onValueChange={(value) => {
                  if (value === "all" || projectOptions.some((option) => option.value === value)) {
                    onFilterChange({ ...activeFilter, project: value });
                  }
                }}>
                  <DropdownMenuRadioItem value="all" data-task-filter="project:all">
                    <Folder className="mr-2 size-3.5" aria-hidden="true" />
                    全部项目
                  </DropdownMenuRadioItem>
                  {projectOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value} data-task-filter={option.value}>
                      <Folder className="mr-2 size-3.5" aria-hidden="true" />
                      <span className="max-w-32 truncate">{option.label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-task-filter-category="agent">
                <Bot className="mr-2 size-3.5" aria-hidden="true" />
                <span>ACP</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup value={activeFilter.agent} onValueChange={(value) => {
                  if (value === "all" || agentOptions.some((option) => option.value === value)) {
                    onFilterChange({ ...activeFilter, agent: value });
                  }
                }}>
                  <DropdownMenuRadioItem value="all" data-task-filter="agent:all">
                    <Bot className="mr-2 size-3.5" aria-hidden="true" />
                    全部 ACP
                  </DropdownMenuRadioItem>
                  {agentOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value} data-task-filter={option.value}>
                      <AgentIcon name={option.label} size={14} />
                      <span className="ml-2 max-w-32 truncate">{option.label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              aria-label="切换任务视图"
              data-task-view-trigger
            >
              <ViewIcon className="size-3.5" aria-hidden="true" />
              <span>{viewLabel}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuLabel>视图</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={view} onValueChange={(value) => {
              if (value === "panel" || value === "table") onViewChange(value);
            }}>
              <DropdownMenuRadioItem value="panel">
                <LayoutPanelTop className="mr-2 size-3.5" aria-hidden="true" />
                看板
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="table">
                <Table2 className="mr-2 size-3.5" aria-hidden="true" />
                表格
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
    <div className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-x-auto overflow-y-hidden pb-1" data-task-view="panel">
      <div className="grid h-full min-h-0 min-w-max grid-flow-col auto-cols-[minmax(13rem,72vw)] gap-2.5 lg:min-w-0 lg:flex-1 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-5 lg:gap-3">
        {groups.map((group) => {
          const ColumnIcon = TASK_COLUMN_ICONS[group.id];
          return (
            <section
              key={group.id}
              className={cn(
                "wb-pane flex min-h-0 min-w-0 self-stretch flex-col overflow-hidden",
                TASK_COLUMN_SURFACES[group.id],
                group.id === "running" && dragOverRunning && "ring-2 ring-primary/50",
              )}
              data-task-column={group.id}
              data-task-column-tone={group.id}
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
              <div className={cn("wb-pane-head min-h-9 px-2.5 lg:px-3", TASK_COLUMN_HEADER_SURFACES[group.id])}>
                <StatusDot tone={TASK_COLUMN_DOT_TONES[group.id]} size={6} pulse={group.id === "running"} />
                <ColumnIcon className={cn("size-3.5 shrink-0", TASK_COLUMN_LABEL_COLORS[group.id])} aria-hidden="true" />
                <span id={`task-group-${group.id}`} className={cn("wb-pane-head-title", TASK_COLUMN_LABEL_COLORS[group.id])}>{group.label}</span>
                <span className={cn("ml-auto font-mono text-meta tabular", TASK_COLUMN_LABEL_COLORS[group.id])}>{group.sessions.length}</span>
              </div>
              {group.sessions.length > 0 ? (
                <ul className="min-h-0 flex-1 divide-y divide-border-ghost overflow-y-auto">
                  {group.sessions.map((session) => {
                    const agent = resolveTaskAgent(session);
                    return (
                      <li
                        key={session.id}
                        data-task-session-row={session.id}
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
                          className="grid w-full min-w-0 gap-1 px-2.5 py-2 text-left transition-colors hover:bg-surface-emphasis/25 lg:px-3"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-section font-medium">{session.title}</span>
                            <span
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary-soft/15 text-primary"
                              data-task-agent-badge={session.agentId ?? "unassigned"}
                              data-task-agent-icon={agent.iconName}
                              role="img"
                              aria-label={`ACP：${agent.label}`}
                              title={`ACP：${agent.label}`}
                            >
                              <AgentIcon name={agent.iconName} size={14} />
                              <span className="sr-only">{agent.label}</span>
                            </span>
                          </span>
                          <span className="truncate font-mono text-meta tabular text-muted-foreground">
                            {formatProjectBranch(session)}
                          </span>
                        </TaskOpenButton>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div
                  className="flex min-h-14 flex-1 items-start justify-center px-3 pt-5 font-mono text-meta text-muted-foreground/80"
                  data-task-empty
                >
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
      <div className="max-w-full overflow-x-auto" data-task-table-scroll>
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
              <TableHead className="min-w-20 px-3 text-meta">状态</TableHead>
              <TableHead className="min-w-40 px-3 text-meta">项目 / 分支</TableHead>
              <TableHead className="min-w-24 px-3 text-meta">Agent</TableHead>
              <TableHead className="min-w-24 px-3 text-meta">计划</TableHead>
              <TableHead className="min-w-28 px-3 text-right text-meta">更新时间</TableHead>
              <TableHead className="sticky right-0 z-10 w-12 bg-surface-sunken/40 px-2 text-right text-meta"><span className="sr-only">操作</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-border-ghost/60">
            {sessions.length > 0 ? sessions.map((session) => {
              const status = resolveTaskStatus(session);
              const StatusIcon = status.icon;
              const agent = resolveTaskAgent(session);
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
                  <TableCell className="px-3 py-2.5">
                    <Badge variant="secondary" className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5">
                      <StatusIcon
                        className={cn("size-3.5", status.iconClassName)}
                        aria-hidden="true"
                        data-task-status-icon={resolveTaskBoardColumn(session)}
                      />
                      <span>{status.label}</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate px-3 py-2.5 font-mono text-meta text-muted-foreground">
                    {formatProjectBranch(session)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <span
                      className={cn("flex min-w-0 items-center gap-1.5 text-meta", !session.agentName && "text-muted-foreground")}
                      title={`ACP：${agent.label}`}
                    >
                      <span
                        className="inline-flex shrink-0 items-center justify-center"
                        data-task-agent-icon={agent.iconName}
                        role="img"
                        aria-label={`ACP：${agent.label}`}
                      >
                        <AgentIcon name={agent.iconName} size={14} />
                      </span>
                      <span className="truncate">{agent.label}</span>
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-meta tabular text-muted-foreground">
                    {session.planSummary?.label ?? "未规划"}
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
      </div>
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
  const [view, setView] = useState<"panel" | "table">(defaultView);
  const [activeFilter, setActiveFilter] = useState<TaskFilterSelection>({
    status: "all",
    project: "all",
    agent: "all",
  });
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [renameSession, setRenameSession] = useState<DashboardActivitySession | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSession, setDeleteSession] = useState<DashboardActivitySession | null>(null);

  const visibleTaskItems = filterTaskSessions(taskItems, activeFilter);
  const projectOptions = buildTaskFilterOptions(
    taskItems,
    resolveTaskProjectFilterValue,
    (session) => session.projectName?.trim() || session.projectId?.trim() || "",
    "未分配项目",
  );
  const agentOptions = buildTaskFilterOptions(
    taskItems,
    resolveTaskAgentFilterValue,
    (session) => session.agentName?.trim() || session.agentId?.trim() || "",
    "未分配 ACP",
  );

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
      for (const session of visibleTaskItems) {
        if (checked) next.add(session.id);
        else next.delete(session.id);
      }
      return next;
    });
  }

  function changeTaskFilter(filter: TaskFilterSelection) {
    setActiveFilter(filter);
    setSelectedSessionIds(new Set());
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" data-task-workspace>
        <TaskToolbar
          activeFilter={activeFilter}
          projectOptions={projectOptions}
          agentOptions={agentOptions}
          view={view}
          onFilterChange={changeTaskFilter}
          onViewChange={setView}
        />
        {view === "panel" ? (
          <TaskPanelView
            sessions={visibleTaskItems}
            onOpenSession={onOpenSession}
            onConfigureReadySession={onConfigureReadySession}
          />
        ) : (
          <TaskTableView
            sessions={visibleTaskItems}
            selectedSessionIds={selectedSessionIds}
            onOpenSession={onOpenSession}
            onConfigureReadySession={onConfigureReadySession}
            onRename={openRename}
            onDelete={setDeleteSession}
            onToggleSession={toggleSession}
            onToggleAll={toggleAll}
          />
        )}
      </div>
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
