import type { FileDiffSummary, MissionPromptContextItem } from "@tiller/shared";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import {
  formatDiffStatus,
  renderDiffPatch,
  renderDiffStats,
  type DiffPointerMode,
} from "./diff-tree";
import { useIsCoarsePointer } from "../hooks/use-pointer-input";
import {
  buildDiffLineRangeLabel,
  buildDiffSelectionSnapshot,
  diffLineKey,
  parseDiffPatchLines,
  selectContiguousDiffLines,
  type ParsedDiffLine,
} from "./diff-comment-selection";
import { GitGraphPanel } from "./git-graph-panel";
import { GitErrorPanel } from "./git-error-panel";
import type { MissionPanelPage } from "./panels";
import type { GitStatusState, GitGraphState } from "../../../store/facade";
import { SelectionCommentPopover } from "../ui/selection-comment-popover";

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
  historicalDiffIncomplete?: boolean;
  onReconnectRuntime?: (runtime: RuntimeOverviewItem) => void;
  gitStatus?: GitStatusState;
  gitGraph?: GitGraphState;
  gitErrorTabOpen?: boolean;
  onRefreshGitStatus?: () => void;
  onSelectGitCommit?: (hash: string) => void;
  onCloseGitErrorTab?: () => void;
  onAddPage: () => void;
  onSelectPage: (pageId: string) => void;
  onDragStart: (pageId: string | null) => void;
  onDrop: (pageId: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
  onMovePage: (pageId: string, direction: -1 | 1) => void;
  onDeletePage: (pageId: string) => void;
  onOpenDiffDetail: (path: string) => void;
  onCloseDiffFile: (path: string) => void;
  onAddDraftContext?: (item: MissionPromptContextItem) => void;
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
  historicalDiffIncomplete,
  gitStatus,
  gitGraph,
  gitErrorTabOpen = false,
  onRefreshGitStatus,
  onSelectGitCommit,
  onCloseGitErrorTab,
  onSelectPage,
  onOpenDiffDetail,
  onCloseDiffFile,
  onAddDraftContext,
  onCollapse,
}: MissionDisplayPanelProps) {
  const isGraphTabSelected = selectedPage.id === "graph";
  const isGitErrorTabSelected = selectedPage.id === "git-error";
  const [graphTabDismissed, setGraphTabDismissed] = useState(false);
  useEffect(() => {
    if (isGraphTabSelected) {
      setGraphTabDismissed(false);
    }
  }, [isGraphTabSelected]);
  const showGraphTab = isGraphTabSelected || (Boolean(gitGraph) && !graphTabDismissed);
  const showGitErrorTab = isGitErrorTabSelected || gitErrorTabOpen;
  const displayTabs = resolveDisplayTabs(
    diffs,
    openedDiffFilePaths,
    selectedDiffFilePath,
    isGraphTabSelected || isGitErrorTabSelected ? null : selectedPage.id,
  );
  const showTabStrip = showGraphTab || showGitErrorTab || displayTabs.length > 0;

  const selectedDisplayDiff = diffs.find((file) => file.path === selectedDiffFilePath);
  const [selectedLineKeys, setSelectedLineKeys] = useState<Set<string>>(new Set());
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
  const [selectionAnchorElement, setSelectionAnchorElement] = useState<HTMLElement | null>(null);
  const [diffCommentMode, setDiffCommentMode] = useState<"actions" | "composer">("actions");
  const [draftComment, setDraftComment] = useState("");
  const displayPaneRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setSelectedLineKeys(new Set());
    setSelectionAnchorKey(null);
    setSelectionAnchorElement(null);
    setDiffCommentMode("actions");
    setDraftComment("");
  }, [selectedDisplayDiff?.path, selectedDisplayDiff?.patch]);
  const isCoarsePointer = useIsCoarsePointer();
  const handleSelectDiffLine = (
    line: ParsedDiffLine,
    anchor: HTMLElement,
    extendRange: boolean,
  ) => {
    const visibleLines = parseDiffPatchLines(selectedDisplayDiff?.patch ?? "");
    const lineKey = diffLineKey(line);
    if (extendRange && selectionAnchorKey) {
      const range = selectContiguousDiffLines(visibleLines, selectionAnchorKey, lineKey);
      setSelectedLineKeys(new Set(range.map((entry) => diffLineKey(entry))));
      setSelectionAnchorElement(range.length ? anchor : null);
      setDiffCommentMode("actions");
      setDraftComment("");
      return;
    }
    setSelectionAnchorKey(lineKey);
    setSelectedLineKeys(new Set(line.kind === "hunk" ? [] : [lineKey]));
    setSelectionAnchorElement(line.kind === "hunk" ? null : anchor);
    setDiffCommentMode("actions");
    setDraftComment("");
  };
  const clearDiffSelection = () => {
    setSelectedLineKeys(new Set());
    setSelectionAnchorKey(null);
    setSelectionAnchorElement(null);
    setDiffCommentMode("actions");
    setDraftComment("");
  };
  const submitDraftDiffContext = () => {
    if (!selectedDisplayDiff || !onAddDraftContext) {
      return;
    }
    const visibleLines = parseDiffPatchLines(selectedDisplayDiff.patch ?? "");
    const selectedLines = visibleLines.filter((line) => selectedLineKeys.has(diffLineKey(line)));
    onAddDraftContext(
      buildDiffSelectionSnapshot({
        filePath: selectedDisplayDiff.path,
        selectedLines,
        comment: draftComment,
      }),
    );
    clearDiffSelection();
  };
  const displayFilePath = selectedDisplayDiff ? selectedDiffFilePath : "未选择文件";
  const closeGraphTab = () => {
    setGraphTabDismissed(true);
    if (isGraphTabSelected) {
      onSelectPage("diff-detail");
    }
  };
  const closeGitErrorTab = () => {
    if (onCloseGitErrorTab) {
      onCloseGitErrorTab();
      return;
    }
    onSelectPage("diff-detail");
  };

  return (
    <aside
      ref={displayPaneRef}
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
      
      {showTabStrip ? (
        <div className="mission-display-tab-strip flex items-center gap-1 overflow-x-auto border-b border-border-ghost px-1 py-1 [scrollbar-width:none]">
          {showGraphTab ? (
            <div
              className={cn(
                "flex h-[22px] shrink-0 items-center gap-1 rounded px-1.5 text-2xs transition-colors",
                isGraphTabSelected
                  ? "bg-surface-emphasis text-foreground"
                  : "text-muted-foreground hover:bg-surface-emphasis hover:text-foreground",
              )}
            >
              <button
                type="button"
                className="flex shrink-0 items-center gap-1"
                onClick={() => onSelectPage("graph")}
              >
                <span className="font-medium">Graph</span>
              </button>
              <button
                type="button"
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                aria-label="关闭 Graph"
                title="关闭 Graph"
                onClick={closeGraphTab}
              >
                <Icon name="x" size={9} className="shrink-0" />
              </button>
            </div>
          ) : null}
          {showGitErrorTab ? (
            <div
              className={cn(
                "flex h-[22px] shrink-0 items-center gap-1 rounded px-1.5 text-2xs transition-colors",
                isGitErrorTabSelected
                  ? "bg-surface-emphasis text-foreground"
                  : "text-muted-foreground hover:bg-surface-emphasis hover:text-foreground",
              )}
            >
              <button
                type="button"
                className="flex shrink-0 items-center gap-1"
                onClick={() => onSelectPage("git-error")}
              >
                <span className="font-medium">Git 错误</span>
              </button>
              <button
                type="button"
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                aria-label="关闭 Git 错误"
                title="关闭 Git 错误"
                onClick={closeGitErrorTab}
              >
                <Icon name="x" size={9} className="shrink-0" />
              </button>
            </div>
          ) : null}
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
      ) : null}
      
      {/* Content area */}
      <section className="mission-panel-content min-h-0 flex-1 overflow-auto p-0">
        {isGraphTabSelected ? (
          <GitGraphPanel gitGraph={gitGraph} onSelectCommit={onSelectGitCommit} />
        ) : isGitErrorTabSelected ? (
          <GitErrorPanel gitStatus={gitStatus} gitGraph={gitGraph} />
        ) : (
          renderDiffDetailPage({
            selectedDiffFilePath,
            diffs,
            noDiffSummary,
            historicalDiffIncomplete,
            selectedLineKeys,
            onSelectDiffLine: handleSelectDiffLine,
            pointerMode: isCoarsePointer ? "coarse" : "fine",
            onAddDraftContext,
          })
        )}
      </section>

      {selectedDisplayDiff && selectionAnchorElement && selectedLineKeys.size > 0 && onAddDraftContext ? (
        <SelectionCommentPopover
          anchor={selectionAnchorElement}
          containment={displayPaneRef.current ?? undefined}
          comment={draftComment}
          context={(
            <>
              <span className="shrink-0 rounded bg-surface-emphasis px-1.5 py-0.5 font-mono text-foreground">
                {buildDiffLineRangeLabel(selectedLineKeys, selectedDisplayDiff)}
              </span>
              <span className="min-w-0 truncate" title={selectedDisplayDiff.path}>
                {selectedDisplayDiff.path.split(/[\\/]/u).at(-1) ?? selectedDisplayDiff.path}
              </span>
            </>
          )}
          mode={diffCommentMode}
          onCancel={clearDiffSelection}
          onChangeComment={setDraftComment}
          onOpenComposer={() => setDiffCommentMode("composer")}
          onSubmit={submitDraftDiffContext}
        />
      ) : null}
      
      {/* Status bar - only show when diff tab selected */}
      {!isGraphTabSelected && !isGitErrorTabSelected ? (
        <div className="mission-display-status-bar flex items-center gap-2 border-t border-border-ghost px-2 py-1 text-2xs text-muted-foreground">
          <Icon name="fileText" size={10} />
          <span className="min-w-0 flex-1 truncate font-mono tabular">{displayFilePath}</span>
          {renderStatusBarInfo(selectedDisplayDiff)}
        </div>
      ) : null}
    </aside>
  );
}

function renderStatusBarInfo(diff: FileDiffSummary | undefined) {
  return diff ? renderDiffStats(diff) : null;
}

type DisplayTab = MissionPanelPage & {
  path: string;
  status: FileDiffSummary["status"];
};

function resolveDisplayTabs(
  diffs: FileDiffSummary[],
  openedDiffFilePaths: string[],
  selectedDiffFilePath: string | null,
  selectedTabId: string | null,
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
    id:
      file.path === selectedPath && selectedTabId
        ? selectedTabId
        : `diff:${file.path}`,
    title: file.path.split(/[\\/]/u).at(-1) ?? file.path,
    path: file.path,
    status: file.status,
  }));
}

type RenderDiffDetailPageInput = {
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  noDiffSummary: string;
  historicalDiffIncomplete?: boolean;
  selectedLineKeys: ReadonlySet<string>;
  onSelectDiffLine: (line: ParsedDiffLine, anchor: HTMLElement, extendRange: boolean) => void;
  pointerMode: DiffPointerMode;
  onAddDraftContext?: (item: MissionPromptContextItem) => void;
};

function renderDiffDetailPage({
  selectedDiffFilePath,
  diffs,
  noDiffSummary,
  historicalDiffIncomplete,
  selectedLineKeys,
  onSelectDiffLine,
  pointerMode,
  onAddDraftContext,
}: RenderDiffDetailPageInput) {
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
          <>
            {renderDiffPatch({
              patch: selectedFile.patch,
              selectedLineKeys: onAddDraftContext ? selectedLineKeys : undefined,
              onSelectRange: onAddDraftContext ? onSelectDiffLine : undefined,
              pointerMode,
            })}
            {selectedFile.patchTruncated && selectedFile.patchRef ? (
              <div className="border-t border-border-ghost px-3 py-2 text-xs text-muted-foreground">
                <a
                  className="text-primary underline underline-offset-2 hover:text-foreground"
                  href={selectedFile.patchRef.uri}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看完整 patch
                </a>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mission-diff-patch-empty p-3 text-sm text-muted-foreground">
            {selectedFile.patchRef ? (
              <a
                className="text-primary underline underline-offset-2 hover:text-foreground"
                href={selectedFile.patchRef.uri}
                target="_blank"
                rel="noreferrer"
              >
                查看完整 patch
              </a>
            ) : historicalDiffIncomplete
              ? "历史快照不完整：该文件未保存 patch/hunk，未从当前工作区补算。"
              : "该 diff 事件没有携带 patch/hunk 内容。"}
          </div>
        )}
      </div>
    </div>
  );
}
