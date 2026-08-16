import type {
  IssueDetail,
  IssueError,
  IssueListState,
  IssueSummary,
  ProjectSummary,
} from "@tiller/shared";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Icon } from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection";
import { requestIssueDetail, requestIssueList } from "../actions/rpc";

type IssueListViewState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "no-project" }
  | { kind: "not-configured" }
  | { kind: "disconnected" }
  | { kind: "error"; error: IssueError };

export type IssuesWorkspaceProps = {
  currentHelmKey: string;
  connection: "connecting" | "connected" | "disconnected";
  projects: ProjectSummary[];
  client: DeckRpcClient | null;
  dispatch: DispatchToHelm;
};

export type IssueDetailPaneProps = {
  summary?: IssueSummary;
  issue?: IssueDetail;
  loading: boolean;
  error?: IssueError;
  onRetry?: () => void;
};

const ISSUE_STATE_LABELS: Record<IssueListState, string> = {
  open: "开放",
  closed: "已关闭",
  all: "全部",
};

function initialListState(project?: ProjectSummary): IssueListViewState {
  if (!project) {
    return { kind: "no-project" };
  }
  return project.issueBinding ? { kind: "loading" } : { kind: "not-configured" };
}

function issueNumber(issue?: IssueSummary) {
  return issue?.ref.issueNumber ? `#${issue.ref.issueNumber}` : "Issue";
}

function formatIssueDate(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function describeIssueError(error: IssueError) {
  switch (error.kind) {
    case "missing-token":
      return "当前 Helm 未配置 GitHub 令牌。请在 Helm 环境中设置 GITHUB_TOKEN 或 GH_TOKEN。";
    case "unauthorized":
      return "GitHub 令牌无效或已失效。请更新 Helm 环境中的令牌。";
    case "forbidden":
      return "GitHub 令牌无权访问此仓库。请检查仓库权限。";
    case "not-found":
      return "未找到 GitHub 仓库或 Issue。请检查项目绑定。";
    case "rate-limited":
      return error.retryAfterSeconds === undefined
        ? "GitHub 请求已受限，请稍后重试。"
        : `GitHub 请求已受限，请在 ${error.retryAfterSeconds} 秒后重试。`;
    default:
      return error.message;
  }
}

function IssueNotice({
  icon,
  title,
  detail,
  action,
}: {
  icon: "folder" | "fileText" | "server" | "circleAlert";
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid size-9 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
        <Icon name={icon} size={17} />
      </span>
      <h2 className="mt-3 text-section font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-md text-meta leading-6 text-muted-foreground">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function IssueListContent({
  state,
  issues,
  selectedIssueNumber,
  onSelectIssue,
  onRetry,
}: {
  state: IssueListViewState;
  issues: IssueSummary[];
  selectedIssueNumber?: string;
  onSelectIssue: (issue: IssueSummary) => void;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <IssueNotice
        icon="fileText"
        title="正在加载 Issues"
        detail="正在从当前 Helm 配置的 GitHub 仓库读取数据。"
      />
    );
  }
  if (state.kind === "no-project") {
    return <IssueNotice icon="folder" title="暂无项目" detail="先在当前 Helm 中配置一个项目。" />;
  }
  if (state.kind === "not-configured") {
    return (
      <IssueNotice
        icon="fileText"
        title="尚未绑定 GitHub 仓库"
        detail="请在项目 YAML 中配置 issueBinding，并使用 owner/repo 作为 remoteKey。"
      />
    );
  }
  if (state.kind === "disconnected") {
    return <IssueNotice icon="server" title="Helm 未连接" detail="连接到当前 Helm 后即可读取项目 Issues。" />;
  }
  if (state.kind === "error") {
    return (
      <IssueNotice
        icon="circleAlert"
        title="无法加载 Issues"
        detail={describeIssueError(state.error)}
        action={<Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button>}
      />
    );
  }
  if (issues.length === 0) {
    return <IssueNotice icon="fileText" title="暂无 Issues" detail="这个筛选条件下没有 GitHub Issue。" />;
  }
  return (
    <ul className="divide-y divide-border-ghost" aria-label="Issue 列表">
      {issues.map((issue) => {
        const number = issue.ref.issueNumber;
        const selected = number !== undefined && number === selectedIssueNumber;
        return (
          <li key={`${issue.ref.remoteKey}:${issue.ref.issueId}`}>
            <button
              type="button"
              className={`grid w-full min-w-0 gap-1 px-3 py-3 text-left transition-colors hover:bg-surface-emphasis/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${selected ? "bg-surface-emphasis" : ""}`}
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelectIssue(issue)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`shrink-0 font-mono text-meta tabular ${issue.state === "open" ? "text-primary" : "text-muted-foreground"}`}>
                  {issueNumber(issue)}
                </span>
                <span className="truncate text-section font-medium text-foreground">{issue.title}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2 font-mono text-2xs tabular text-muted-foreground">
                <span className="truncate">{issue.author?.displayName ?? "未知作者"}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{formatIssueDate(issue.updatedAt)}</span>
              </span>
              {issue.labels.length > 0 ? (
                <span className="flex flex-wrap gap-1 pt-1">
                  {issue.labels.slice(0, 3).map((label) => (
                    <span
                      key={label.id}
                      className="max-w-full truncate rounded border border-border-ghost px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                      style={label.color ? { borderColor: `#${label.color}` } : undefined}
                    >
                      {label.name}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function IssueDetailPane({
  summary,
  issue,
  loading,
  error,
  onRetry,
}: IssueDetailPaneProps) {
  const visibleIssue = issue ?? summary;
  if (!visibleIssue && !loading && !error) {
    return <IssueNotice icon="fileText" title="选择一个 Issue" detail="从左侧列表查看完整描述和元数据。" />;
  }
  if (!visibleIssue && loading) {
    return <IssueNotice icon="fileText" title="正在加载详情" detail="正在读取 GitHub Issue 内容。" />;
  }
  if (!visibleIssue && error) {
    return (
      <IssueNotice
        icon="circleAlert"
        title="无法加载详情"
        detail={describeIssueError(error)}
        action={onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>重试</Button> : undefined}
      />
    );
  }
  if (!visibleIssue) {
    return null;
  }
  const detail = issue;
  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`${issueNumber(visibleIssue)} ${visibleIssue.title}`}>
      <header className="border-b border-border-ghost px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-mono text-2xs font-medium ${visibleIssue.state === "open" ? "bg-primary-soft text-primary" : "bg-surface-sunken text-muted-foreground"}`}>
            {visibleIssue.state === "open" ? "开放" : "已关闭"}
          </span>
          <span className="font-mono text-meta tabular text-muted-foreground">{issueNumber(visibleIssue)}</span>
          <a
            href={visibleIssue.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto shrink-0 font-mono text-meta text-primary hover:underline"
          >
            打开 GitHub
          </a>
        </div>
        <h2 className="mt-3 break-words text-section font-semibold leading-6 text-foreground">{visibleIssue.title}</h2>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-2xs tabular text-muted-foreground">
          <span>作者 {visibleIssue.author?.displayName ?? "未知"}</span>
          <span>更新 {formatIssueDate(visibleIssue.updatedAt)}</span>
          {visibleIssue.assignees.length > 0 ? <span>负责人 {visibleIssue.assignees.map((item) => item.displayName).join(", ")}</span> : null}
        </div>
        {visibleIssue.labels.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {visibleIssue.labels.map((label) => (
              <span
                key={label.id}
                className="rounded border border-border-ghost px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                style={label.color ? { borderColor: `#${label.color}` } : undefined}
              >
                {label.name}
              </span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="font-mono text-meta text-muted-foreground" role="status">正在加载详情...</div>
        ) : error ? (
          <div className="grid gap-3">
            <p className="text-meta text-destructive">{describeIssueError(error)}</p>
            {onRetry ? <Button type="button" size="sm" variant="outline" className="w-fit" onClick={onRetry}>重试</Button> : null}
          </div>
        ) : detail?.body?.trim() ? (
          <MarkdownMessage text={detail.body} renderMermaid={false} repairMalformedTables />
        ) : (
          <p className="font-mono text-meta text-muted-foreground">该 Issue 没有描述。</p>
        )}
      </div>
    </article>
  );
}

export function IssuesWorkspace({
  currentHelmKey,
  connection,
  projects,
  client,
  dispatch,
}: IssuesWorkspaceProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(() => projects[0]?.id ?? "");
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const [stateFilter, setStateFilter] = useState<IssueListState>("open");
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [listState, setListState] = useState<IssueListViewState>(() => initialListState(projects[0]));
  const [selectedSummary, setSelectedSummary] = useState<IssueSummary>();
  const [selectedIssue, setSelectedIssue] = useState<IssueDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<IssueError>();
  const requestGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const latestClientRef = useRef(client);
  const latestDispatchRef = useRef(dispatch);
  latestClientRef.current = client;
  latestDispatchRef.current = dispatch;
  const selectedBindingKey = selectedProject?.issueBinding?.remoteKey;

  useEffect(() => {
    setSelectedProjectId((current) => projects.some((project) => project.id === current)
      ? current
      : projects[0]?.id ?? "");
  }, [projects]);

  const loadPage = useCallback(async (
    cursor: string | undefined,
    onSuccess?: () => void,
  ) => {
    const projectId = selectedProjectId;
    if (!projectId) {
      setIssues([]);
      setNextCursor(undefined);
      setListState({ kind: "no-project" });
      return;
    }
    if (!selectedBindingKey) {
      setIssues([]);
      setNextCursor(undefined);
      setListState({ kind: "not-configured" });
      return;
    }
    const targetClient = latestClientRef.current;
    if (connection !== "connected" || !targetClient || targetClient.socket.readyState !== 1) {
      setIssues([]);
      setNextCursor(undefined);
      setListState({ kind: "disconnected" });
      return;
    }

    const generation = ++requestGenerationRef.current;
    setListState({ kind: "loading" });
    const result = await requestIssueList(targetClient, latestDispatchRef.current, {
      projectId,
      state: stateFilter,
      cursor,
      sourceHelmKey: currentHelmKey,
    });
    if (generation !== requestGenerationRef.current) {
      return;
    }
    if (!result.ok) {
      setIssues([]);
      setNextCursor(undefined);
      setListState({ kind: "error", error: result.error ?? { kind: "invalid-response", message: result.message } });
      return;
    }
    setIssues(result.issues);
    setNextCursor(result.nextCursor);
    setListState(result.issues.length > 0 ? { kind: "ready" } : { kind: "empty" });
    onSuccess?.();
  }, [connection, currentHelmKey, selectedBindingKey, selectedProjectId, stateFilter]);

  useEffect(() => {
    setPageCursors([undefined]);
    setNextCursor(undefined);
    setSelectedSummary(undefined);
    setSelectedIssue(undefined);
    setDetailError(undefined);
    setDetailLoading(false);
    void loadPage(undefined);
    return () => {
      requestGenerationRef.current += 1;
      detailGenerationRef.current += 1;
    };
  }, [loadPage]);

  const refresh = () => {
    void loadPage(pageCursors.at(-1));
  };

  const selectIssue = (summary: IssueSummary) => {
    const issueNumberValue = summary.ref.issueNumber;
    if (!issueNumberValue || !selectedProjectId) {
      return;
    }
    const targetClient = latestClientRef.current;
    if (connection !== "connected" || !targetClient || targetClient.socket.readyState !== 1) {
      setSelectedSummary(summary);
      setSelectedIssue(undefined);
      setDetailLoading(false);
      setDetailError({ kind: "network", message: "Helm 未连接" });
      return;
    }
    const generation = ++detailGenerationRef.current;
    setSelectedSummary(summary);
    setSelectedIssue(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    void requestIssueDetail(targetClient, latestDispatchRef.current, {
      projectId: selectedProjectId,
      issueNumber: issueNumberValue,
      sourceHelmKey: currentHelmKey,
    }).then((result) => {
      if (generation !== detailGenerationRef.current) {
        return;
      }
      setDetailLoading(false);
      if (!result.ok || !result.issue) {
        setDetailError(result.error ?? { kind: "invalid-response", message: result.message });
        return;
      }
      setSelectedIssue(result.issue);
    });
  };

  const previousPage = () => {
    if (pageCursors.length < 2) {
      return;
    }
    const previousCursor = pageCursors[pageCursors.length - 2];
    void loadPage(previousCursor, () => {
      setPageCursors((current) => current.slice(0, -1));
      setSelectedSummary(undefined);
      setSelectedIssue(undefined);
    });
  };

  const nextPage = () => {
    if (!nextCursor) {
      return;
    }
    const cursor = nextCursor;
    void loadPage(cursor, () => {
      setPageCursors((current) => [...current, cursor]);
      setSelectedSummary(undefined);
      setSelectedIssue(undefined);
    });
  };

  const retryDetail = () => {
    if (selectedSummary) {
      selectIssue(selectedSummary);
    }
  };

  const selectedIssueNumber = selectedSummary?.ref.issueNumber;
  const canNavigatePages = listState.kind === "ready" || listState.kind === "empty";
  return (
    <section className="issues-workspace flex h-full min-h-0 min-w-0 flex-col bg-surface" aria-label="GitHub Issues" data-testid="issues-workspace">
      <header className="flex flex-wrap items-center gap-2 border-b border-border-ghost px-4 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <Icon name="fileText" size={15} className="shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="truncate text-section font-semibold text-foreground">GitHub Issues</h1>
            <p className="truncate font-mono text-2xs tabular text-muted-foreground">
              {selectedProject?.issueBinding?.remoteKey ?? "未绑定仓库"}
            </p>
          </div>
        </div>
        <label className="flex min-w-0 items-center gap-2 font-mono text-2xs text-muted-foreground">
          <span className="shrink-0">项目</span>
          <select
            className="h-[var(--control-h-sm)] max-w-44 rounded border border-border-ghost bg-surface px-2 text-meta text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            aria-label="选择 Issue 项目"
          >
            {projects.length === 0 ? <option value="">暂无项目</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 font-mono text-2xs text-muted-foreground">
          <span>状态</span>
          <select
            className="h-[var(--control-h-sm)] rounded border border-border-ghost bg-surface px-2 text-meta text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value as IssueListState)}
            aria-label="筛选 Issue 状态"
          >
            {(Object.keys(ISSUE_STATE_LABELS) as IssueListState[]).map((value) => (
              <option key={value} value={value}>{ISSUE_STATE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <Button type="button" size="icon-sm" variant="ghost" title="刷新 Issues" aria-label="刷新 Issues" onClick={refresh}>
          <Icon name="refresh" />
        </Button>
      </header>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[minmax(260px,0.75fr)_minmax(280px,1fr)] divide-y divide-border-ghost overflow-hidden lg:grid-cols-[minmax(280px,0.42fr)_minmax(0,1fr)] lg:grid-rows-1 lg:divide-x lg:divide-y-0">
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-9 items-center border-b border-border-ghost px-3">
            <span className="font-mono text-meta text-muted-foreground">Issues</span>
            {listState.kind === "ready" ? <span className="ml-1.5 font-mono text-2xs tabular text-muted-foreground">{issues.length}</span> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IssueListContent
              state={listState}
              issues={issues}
              selectedIssueNumber={selectedIssueNumber}
              onSelectIssue={selectIssue}
              onRetry={refresh}
            />
          </div>
          <footer className="flex min-h-11 items-center justify-between border-t border-border-ghost px-3">
            <span className="font-mono text-2xs tabular text-muted-foreground">第 {pageCursors.length} 页</span>
            <span className="flex items-center gap-1">
              <Button type="button" size="icon-sm" variant="ghost" aria-label="上一页" title="上一页" disabled={!canNavigatePages || pageCursors.length < 2} onClick={previousPage}>
                <Icon name="chevronLeft" />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="下一页" title="下一页" disabled={!canNavigatePages || !nextCursor} onClick={nextPage}>
                <Icon name="chevronRight" />
              </Button>
            </span>
          </footer>
        </section>
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <IssueDetailPane
            summary={selectedSummary}
            issue={selectedIssue}
            loading={detailLoading}
            error={detailError}
            onRetry={retryDetail}
          />
        </section>
      </div>
    </section>
  );
}
