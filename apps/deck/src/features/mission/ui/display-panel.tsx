import type { FileDiffSummary } from "@tiller/shared";
import type { CSSProperties, ReactNode } from "react";
import { Button, Card, CardContent, Icon, Input } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import {
  formatDiffStatus,
  renderDiffPatch,
  renderDiffStats,
  resolveMissionPanelIcon,
} from "./diff-tree";
import type { MissionPanelPage } from "./panels";

type OverviewItem = {
  label: string;
  value: string;
};

function parseOverviewItem(item: string): OverviewItem {
  const [label, ...valueParts] = item.split(" · ");
  return {
    label: label || "信息",
    value: valueParts.join(" · ") || item,
  };
}

function isWorktreeOverviewItem(label: string): boolean {
  return label.toLowerCase() === "worktree";
}

export type RuntimeOverviewItem = {
  id: string;
  agentId?: string;
  projectId?: string;
  worktreeId?: string;
  label: string;
  meta: string;
  status: string;
  runtimeSessionId: string;
  model?: string;
  reasoningEffort?: string;
  canConnect?: boolean;
  canReconnect?: boolean;
  children?: Array<{
    id: string;
    projectName: string;
    branchName: string;
    status: string;
    model?: string;
    reasoningEffort?: string;
  }>;
};

function runtimeStatusBadgeClass(status: string): string {
  if (status.includes("已连接") || status.includes("ready")) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (status.includes("未连接") || status.includes("closed")) {
    return "bg-surface-emphasis text-muted-foreground";
  }
  if (status.includes("错误") || status.includes("失败") || status.includes("error")) {
    return "bg-destructive/15 text-destructive";
  }
  if (status.includes("连接中") || status.includes("预热中") || status.includes("starting")) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  }
  return "bg-primary-soft text-primary";
}

function formatRuntimeChildMeta(child: NonNullable<RuntimeOverviewItem["children"]>[number]) {
  return [
    child.branchName,
    child.status,
    child.model,
    child.reasoningEffort ? `推理 ${child.reasoningEffort}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

type MissionDisplayPanelProps = {
  style: CSSProperties;
  pages: MissionPanelPage[];
  selectedPage: MissionPanelPage;
  overviewItems: string[];
  runtimeOverviewItems: RuntimeOverviewItem[];
  currentModelSummary?: string | null;
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  noDiffSummary: string;
  onReconnectRuntime?: (runtime: RuntimeOverviewItem) => void;
  logbookContent: ReactNode;
  onAddPage: () => void;
  onSelectPage: (pageId: string) => void;
  onDragStart: (pageId: string | null) => void;
  onDrop: (pageId: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
  onMovePage: (pageId: string, direction: -1 | 1) => void;
  onDeletePage: (pageId: string) => void;
};
export function MissionDisplayPanel({
  style,
  pages,
  selectedPage,
  overviewItems,
  runtimeOverviewItems,
  currentModelSummary,
  selectedDiffFilePath,
  diffs,
  noDiffSummary,
  onReconnectRuntime,
  logbookContent,
  onAddPage,
  onSelectPage,
  onDragStart,
  onDrop,
  onRenamePage,
  onMovePage,
  onDeletePage,
}: MissionDisplayPanelProps) {
  const renderSelectedPage = () => {
    if (selectedPage.id === "logbook") {
      return (
        <div className="mission-panel-page mission-logbook-page grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          {" "}
          {logbookContent}{" "}
        </div>
      );
    }
    if (selectedPage.id === "diff-detail") {
      return renderDiffDetailPage({ selectedDiffFilePath, diffs, noDiffSummary });
    }
    if (selectedPage.id.startsWith("custom-")) {
      return (
        <div className="mission-panel-page mission-custom-page grid gap-3">
          {" "}
          <Card className="mission-custom-page-tools shadow-none">
            <CardContent className="grid gap-3 p-3">
              {" "}
              <label className="grid gap-1 text-sm font-medium text-foreground">
                {" "}
                <span className="text-xs uppercase tracking-wider text-muted-foreground">展示页名称</span>{" "}
              <Input
                value={selectedPage.title}
                onChange={(event) =>
                  onRenamePage(selectedPage.id, event.target.value)
                }
              />{" "}
            </label>{" "}
            <div className="mission-custom-page-actions flex flex-wrap gap-2">
              {" "}
              <Button
                variant="outline"
                type="button"
                onClick={() => onMovePage(selectedPage.id, -1)}
              >
                {" "}
                上移{" "}
              </Button>{" "}
              <Button
                variant="outline"
                type="button"
                onClick={() => onMovePage(selectedPage.id, 1)}
              >
                {" "}
                下移{" "}
              </Button>{" "}
              <Button
                variant="destructive"
                type="button"
                onClick={() => onDeletePage(selectedPage.id)}
              >
                {" "}
                删除展示页{" "}
              </Button>{" "}
            </div>{" "}
            </CardContent>
          </Card>{" "}
          <div className="empty-state rounded-[8px] border border-border-ghost bg-surface-sunken p-3 text-meta text-muted-foreground">
            {" "}
            自定义展示页占位，可继续挂载文件树、预览、测试结果或工具输出。{" "}
          </div>{" "}
        </div>
      );
    }
    const worktreeOverviewItems = overviewItems
      .map(parseOverviewItem)
      .filter((item) => isWorktreeOverviewItem(item.label));
    return (
      <div className="mission-panel-page mission-overview-page grid gap-3">
        {worktreeOverviewItems.length ? (
          <div className="mission-overview-grid grid gap-2">
            {worktreeOverviewItems.map((overviewItem) => {
              return (
                <Card
                  key={`${overviewItem.label}:${overviewItem.value}`}
                  className="mission-overview-card rounded-[8px] border-border-ghost bg-surface-sunken shadow-none"
                >
                  <CardContent className="grid gap-1 p-3">
                    <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {overviewItem.label}
                    </span>
                    <strong
                      className="min-w-0 truncate text-section font-semibold leading-snug text-foreground"
                    >
                      {overviewItem.value}
                    </strong>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="empty-state rounded-[8px] border border-border-ghost bg-surface-sunken p-3 text-meta text-muted-foreground">
            选择左侧任务后显示 Worktree 信息
          </div>
        )}
        {currentModelSummary ? (
          <div className="mission-current-model-line rounded-[8px] border border-border-ghost bg-surface-sunken px-3 py-2 text-meta text-muted-foreground">
            {currentModelSummary}
          </div>
        ) : null}
        <Card className="mission-runtime-overview border-border-ghost bg-surface-sunken shadow-none">
          <CardContent className="grid gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                ACP
              </span>
              <span className="rounded-full bg-surface-emphasis px-2 py-0.5 font-mono text-2xs tabular text-muted-foreground">
                {runtimeOverviewItems.length} 个
              </span>
            </div>
            {runtimeOverviewItems.length ? (
              <div className="grid gap-2">
                {runtimeOverviewItems.map((runtime) => (
                  <details
                    key={runtime.id}
                    className="mission-runtime-item grid gap-1 rounded-[8px] border border-border-ghost bg-surface px-2.5 py-2"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 marker:hidden">
                      <strong className="min-w-0 truncate text-section text-foreground">
                        {runtime.label}
                      </strong>
                      <span className="flex shrink-0 items-center gap-1">
                        {runtime.canConnect || runtime.canReconnect ? (
                          <button
                            type="button"
                            className="rounded-full border border-border-ghost px-2 py-0.5 text-meta font-medium text-muted-foreground hover:border-primary/50 hover:text-primary"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onReconnectRuntime?.(runtime);
                            }}
                            disabled={!runtime.agentId || !onReconnectRuntime}
                            title={runtime.canReconnect ? "重连 ACP" : "连接 ACP"}
                          >
                            {runtime.canReconnect ? "重连" : "连接"}
                          </button>
                        ) : null}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-meta font-medium",
                            runtimeStatusBadgeClass(runtime.status),
                          )}
                        >
                          {runtime.status}
                        </span>
                      </span>
                    </summary>
                    <code className="mt-1 block break-all font-mono text-meta tabular text-muted-foreground">
                      {runtime.runtimeSessionId}
                    </code>
                    {runtime.children?.length ? (
                      <ul className="mt-1 grid gap-1 text-meta text-muted-foreground">
                        {runtime.children.map((child) => (
                          <li key={child.id} className="grid gap-0.5 rounded-[8px] bg-surface-sunken px-2 py-1">
                            <span className="font-medium text-foreground">{child.projectName}</span>
                            <span>
                              {formatRuntimeChildMeta(child)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <small className="mt-1 block text-meta text-muted-foreground">
                        {runtime.meta}{runtime.model ? ` · ${runtime.model}` : ""}
                      </small>
                    )}
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无正在运行或预热的 ACP。</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };
  const displayFilePath = selectedDiffFilePath ?? diffs[0]?.path ?? selectedPage.title;
  const selectedDisplayDiff = diffs.find((file) => file.path === displayFilePath) ?? diffs[0];
  return (
    <aside
      className="mission-display-panel mission-pane mission-pane-display col-start-5 col-end-6 flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken border-l border-border-ghost shadow-none"
      style={style}
      aria-label="任务展示容器"
      data-mission-mobile-pane="display"
    >
      <div className="wb-pane-head">
        <span className="wb-pane-head-eyebrow">展示栏</span>
        <div className="flex-1" />
        <button
          type="button"
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-surface-emphasis"
          title="收起展示栏"
          aria-label="收起展示栏"
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div className="mission-display-tab-strip flex items-center gap-1 overflow-x-auto border-b border-border-ghost px-1 py-1 [scrollbar-width:none]">
        {pages.map((page) => {
          const selected = page.id === selectedPage.id;
          const custom = page.id.startsWith("custom-");
          return (
            <button
              key={page.id}
              type="button"
              className={cn(
                "flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-2xs transition-colors",
                selected
                  ? "bg-surface-emphasis text-foreground"
                  : "text-muted-foreground hover:bg-surface-emphasis hover:text-foreground",
              )}
              title={page.title}
              draggable={custom}
              onClick={() => onSelectPage(page.id)}
              onDragStart={() => {
                if (custom) onDragStart(page.id);
              }}
              onDragOver={(event) => {
                if (custom) event.preventDefault();
              }}
              onDrop={() => {
                if (custom) onDrop(page.id);
              }}
            >
              <span className="text-2xs">{resolveMissionPanelIcon(page.id)}</span>
              <span className="max-w-[150px] truncate font-mono tabular">{page.title}</span>
              {selected ? (
                <Icon name="x" size={9} className="ml-1 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-emphasis hover:text-foreground"
          title="新增展示页"
          aria-label="新增展示页"
          onClick={onAddPage}
        >
          <Icon name="plus" size={10} />
        </button>
      </div>
      <section className="mission-panel-content min-h-0 flex-1 overflow-auto p-3">
        {renderSelectedPage()}
      </section>
      <div className="mission-display-status-bar flex items-center gap-2 border-t border-border-ghost px-2 py-1 text-2xs text-muted-foreground">
        <Icon name="fileText" size={10} />
        <span className="min-w-0 flex-1 truncate font-mono tabular">{displayFilePath}</span>
        {selectedDisplayDiff ? renderDiffStats(selectedDisplayDiff) : null}
      </div>
    </aside>
  );
}

type RenderDiffDetailPageInput = {
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  noDiffSummary: string;
};

function renderDiffDetailPage({ selectedDiffFilePath, diffs, noDiffSummary }: RenderDiffDetailPageInput) {
  const selectedFile = diffs.find((file) => file.path === selectedDiffFilePath) ?? diffs[0];
  if (!selectedFile) {
    return (
      <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
        {noDiffSummary}
      </div>
    );
  }
  return (
    <div className="mission-panel-page mission-diff-detail grid min-h-0 gap-2 overflow-hidden" aria-label="Diff 详情">
      <div className="mission-diff-file min-w-0 overflow-hidden rounded-md border border-border-ghost bg-surface-sunken">
        <div className="mission-file-row mission-diff-file-summary grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground">
          <span className={`mission-file-status status-${selectedFile.status} rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary`}>
            {formatDiffStatus(selectedFile.status)}
          </span>
          <strong className="min-w-0 truncate">{selectedFile.path}</strong>
          {renderDiffStats(selectedFile)}
        </div>
        {selectedFile.patch ? (
          renderDiffPatch(selectedFile.patch)
        ) : (
          <div className="mission-diff-patch-empty p-3 text-sm text-muted-foreground">
            该 diff 事件没有携带 patch/hunk 内容。
          </div>
        )}
      </div>
    </div>
  );
}
