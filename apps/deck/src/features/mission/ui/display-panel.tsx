import type { FileDiffSummary } from "@tiller/shared";
import type { CSSProperties, ReactNode } from "react";
import { Button, Card, CardContent, Input } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { formatDiffStatus, renderDiffPatch, renderDiffStats } from "./diff-tree";
import { MissionPanelNav, type MissionPanelPage } from "./panels";

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

function isWideOverviewItem(label: string): boolean {
  return label === "路径" || label === "摘要";
}

export type RuntimeOverviewItem = {
  id: string;
  agentId?: string;
  projectId?: string;
  workspaceId?: string;
  label: string;
  meta: string;
  status: string;
  runtimeSessionId: string;
  model?: string;
  children?: Array<{
    id: string;
    projectName: string;
    branchName: string;
    status: string;
    model?: string;
  }>;
};

type MissionDisplayPanelProps = {
  style: CSSProperties;
  pages: MissionPanelPage[];
  selectedPage: MissionPanelPage;
  overviewItems: string[];
  runtimeOverviewItems: RuntimeOverviewItem[];
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
          <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
            {" "}
            自定义展示页占位，可继续挂载文件树、预览、测试结果或工具输出。{" "}
          </div>{" "}
        </div>
      );
    }
    return (
      <div className="mission-panel-page mission-overview-page grid gap-3">
        {overviewItems.length ? (
          <div className="mission-overview-grid grid grid-cols-2 gap-2 max-xl:grid-cols-1">
            {overviewItems.map((item) => {
              const overviewItem = parseOverviewItem(item);
              return (
                <Card
                  key={item}
                  className={cn(
                    "mission-overview-card border-border-ghost bg-surface-sunken shadow-none",
                    isWideOverviewItem(overviewItem.label) && "col-span-2 max-xl:col-span-1",
                  )}
                >
                  <CardContent className="grid gap-1 p-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {overviewItem.label}
                    </span>
                    <strong
                      className={cn(
                        "text-sm font-semibold leading-relaxed text-foreground",
                        overviewItem.label === "路径" && "break-all font-mono text-xs",
                        overviewItem.label === "摘要" && "font-normal text-muted-foreground",
                      )}
                    >
                      {overviewItem.value}
                    </strong>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
            选择左侧任务后显示项目信息
          </div>
        )}
        <Card className="mission-runtime-overview border-border-ghost bg-surface-sunken shadow-none">
          <CardContent className="grid gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                ACP
              </span>
              <span className="rounded-full bg-surface-emphasis px-2 py-0.5 text-[10px] text-muted-foreground">
                {runtimeOverviewItems.length} 个
              </span>
            </div>
            {runtimeOverviewItems.length ? (
              <div className="grid gap-2">
                {runtimeOverviewItems.map((runtime) => (
                  <details
                    key={runtime.id}
                    className="grid gap-1 rounded-md border border-border-ghost bg-surface px-2.5 py-2"
                    open
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 marker:hidden">
                      <strong className="min-w-0 truncate text-sm text-foreground">
                        {runtime.label}
                      </strong>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="rounded-full border border-border-ghost px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onReconnectRuntime?.(runtime);
                          }}
                          disabled={!runtime.agentId || !onReconnectRuntime}
                          title="重连 ACP"
                        >
                          重连
                        </button>
                        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {runtime.status}
                        </span>
                      </span>
                    </summary>
                    <code className="mt-1 block break-all text-[11px] text-muted-foreground">
                      {runtime.runtimeSessionId}
                    </code>
                    {runtime.children?.length ? (
                      <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
                        {runtime.children.map((child) => (
                          <li key={child.id} className="grid gap-0.5 rounded bg-surface-sunken px-2 py-1">
                            <span className="font-medium text-foreground">{child.projectName}</span>
                            <span>
                              {child.branchName} · {child.status}{child.model ? ` · ${child.model}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <small className="mt-1 block text-xs text-muted-foreground">
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
  return (
    <aside
      className="mission-display-panel mission-pane mission-pane-display col-start-5 col-end-6 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface shadow-none"
      style={style}
      aria-label="任务展示容器"
    >
      {" "}
      <div className="mission-panel-head flex items-start justify-between gap-3 border-b border-border-ghost p-3">
        {" "}
        <div>
          {" "}
          <p className="eyebrow text-xs font-semibold uppercase tracking-wider text-muted-foreground">展示</p> <h3 className="text-base font-semibold text-foreground">任务展示</h3>{" "}
        </div>{" "}
        <Button
          size="icon"
          variant="outline"
          type="button"
          onClick={onAddPage}
          aria-label="增加展示页"
        >
          {" "}
          ＋{" "}
        </Button>{" "}
      </div>{" "}
      <div className="mission-panel-body grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-0">
        {" "}
        <MissionPanelNav
          pages={pages}
          selectedPageId={selectedPage.id}
          onSelect={onSelectPage}
          onDragStart={onDragStart}
          onDrop={onDrop}
        />{" "}
        <section className="mission-panel-content min-h-0 overflow-auto p-3">
          {" "}
          {renderSelectedPage()}{" "}
        </section>{" "}
      </div>{" "}
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
