import type { FileDiffSummary } from "@tiller/shared";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import {
  formatDiffStatus,
  renderDiffPatch,
  renderDiffStats,
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
  openedDiffFilePaths: string[];
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
  onOpenDiffDetail: (path: string) => void;
  onCloseDiffFile: (path: string) => void;
  onCollapse: () => void;
};
export function MissionDisplayPanel({
  style,
  pages,
  selectedPage,
  openedDiffFilePaths,
  selectedDiffFilePath,
  diffs,
  noDiffSummary,
  onOpenDiffDetail,
  onCloseDiffFile,
  onCollapse,
}: MissionDisplayPanelProps) {
  const selectedDisplayFilePath = selectedDiffFilePath ?? openedDiffFilePaths.at(-1) ?? null;
  const renderSelectedPage = () => {
    return renderDiffDetailPage({ selectedDiffFilePath: selectedDisplayFilePath, diffs, noDiffSummary });
  };
  const selectedDisplayDiff = diffs.find((file) => file.path === selectedDisplayFilePath);
  const displayFilePath = selectedDisplayDiff ? selectedDisplayFilePath : "未选择文件";
  const displayTabs = resolveDisplayTabs(diffs, openedDiffFilePaths, selectedDisplayFilePath, selectedPage);
  return (
    <aside
      className="mission-display-panel mission-pane mission-pane-display col-start-5 col-end-6 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken shadow-none"
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
          onClick={onCollapse}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div className="mission-display-tab-strip flex items-center gap-1 overflow-x-auto border-b border-border-ghost px-1 py-1 [scrollbar-width:none]">
        {displayTabs.map((page) => {
          const selected = page.id === selectedPage.id;
          return (
            <div
              key={page.id}
              className={cn(
                "flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-2xs transition-colors",
                selected
                  ? "bg-surface-emphasis text-foreground"
                  : "text-muted-foreground hover:bg-surface-emphasis hover:text-foreground",
              )}
              title={page.title}
            >
              <button
                type="button"
                className="flex shrink-0 items-center gap-1"
                onClick={() => onOpenDiffDetail(page.path)}
              >
                <span className={`mission-file-status status-${page.status} bg-transparent px-0.5 py-0 text-2xs font-semibold text-primary`}>
                  {formatDiffStatus(page.status)}
                </span>
                <span className="whitespace-nowrap font-mono tabular">{page.title}</span>
              </button>
              <button
                type="button"
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                aria-label={`关闭 ${page.title}`}
                title={`关闭 ${page.title}`}
                onClick={() => onCloseDiffFile(page.path)}
              >
                <Icon name="x" size={9} className="shrink-0" />
              </button>
            </div>
          );
        })}
      </div>
      <section className="mission-panel-content min-h-0 flex-1 overflow-auto p-0">
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

type DisplayTab = MissionPanelPage & {
  path: string;
  status: FileDiffSummary["status"];
};

function resolveDisplayTabs(
  diffs: FileDiffSummary[],
  openedDiffFilePaths: string[],
  selectedDiffFilePath: string | null,
  fallbackPage: MissionPanelPage,
): DisplayTab[] {
  const selectedPath = selectedDiffFilePath;
  const openPaths = [...openedDiffFilePaths];
  if (selectedPath && !openPaths.includes(selectedPath)) {
    openPaths.push(selectedPath);
  }
  const openFiles = openPaths
    .map((path) => diffs.find((file) => file.path === path))
    .filter((file): file is FileDiffSummary => Boolean(file));
  if (!openFiles.length) {
    return [];
  }
  return openFiles.map((file) => ({
    id: file.path === selectedPath ? fallbackPage.id : `diff:${file.path}`,
    title: file.path.split(/[\\/]/u).at(-1) ?? file.path,
    path: file.path,
    status: file.status,
  }));
}

type RenderDiffDetailPageInput = {
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  noDiffSummary: string;
};

function renderDiffDetailPage({ selectedDiffFilePath, diffs, noDiffSummary }: RenderDiffDetailPageInput) {
  const selectedFile = selectedDiffFilePath
    ? diffs.find((file) => file.path === selectedDiffFilePath)
    : null;
  if (!selectedFile) {
    return (
      <div className="empty-state bg-transparent p-4 text-sm text-muted-foreground">
        {noDiffSummary}
      </div>
    );
  }
  return (
    <div className="mission-panel-page mission-diff-detail grid min-h-0 overflow-hidden" aria-label="Diff 文件详情">
      <div className="mission-diff-file min-w-0 overflow-hidden bg-transparent">
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
