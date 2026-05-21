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
  selectedDiffFilePath,
  diffs,
  noDiffSummary,
  onAddPage,
  onSelectPage,
  onDragStart,
  onDrop,
  onRenamePage,
  onMovePage,
  onDeletePage,
}: MissionDisplayPanelProps) {
  const renderSelectedPage = () => {
    if (selectedPage.id.startsWith("custom-")) {
      return (
        <div className="mission-panel-page mission-custom-page grid gap-3">
          <Card className="mission-custom-page-tools rounded-[8px] shadow-none">
            <CardContent className="grid gap-3 p-3">
              <label className="grid gap-1 text-sm font-medium text-foreground">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">展示页名称</span>
                <Input
                  value={selectedPage.title}
                  onChange={(event) => onRenamePage(selectedPage.id, event.target.value)}
                />
              </label>
              <div className="mission-custom-page-actions flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => onMovePage(selectedPage.id, -1)}
                >
                  上移
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => onMovePage(selectedPage.id, 1)}
                >
                  下移
                </Button>
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => onDeletePage(selectedPage.id)}
                >
                  删除展示页
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="empty-state rounded-[8px] border border-border-ghost bg-surface-sunken p-3 text-meta text-muted-foreground">
            自定义展示页占位，可继续挂载文件树、预览、测试结果或工具输出。
          </div>
        </div>
      );
    }

    return renderDiffDetailPage({ selectedDiffFilePath, diffs, noDiffSummary });
  };
  const displayFilePath = selectedDiffFilePath ?? diffs[0]?.path ?? selectedPage.title;
  const selectedDisplayDiff = diffs.find((file) => file.path === displayFilePath) ?? diffs[0];
  return (
    <aside
      className="mission-display-panel mission-pane mission-pane-display col-start-5 col-end-6 flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken shadow-none"
      style={style}
      aria-label="任务展示容器"
      data-mission-mobile-pane="display"
      data-testid="mission-display-panel"
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
      <div className="empty-state rounded-[8px] border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
        {noDiffSummary}
      </div>
    );
  }
  return (
    <div className="mission-panel-page mission-diff-detail grid min-h-0 gap-2 overflow-hidden" aria-label="Diff 详情">
      <div className="mission-diff-file min-w-0 overflow-hidden rounded-[8px] border border-border-ghost bg-surface-sunken">
        <div className="mission-file-row mission-diff-file-summary grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-foreground">
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
