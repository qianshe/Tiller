import type { CSSProperties, ReactNode } from "react";
import type { FileDiffSummary } from "@tiller/shared";
import { InfoList } from "../../../components/primitives";
import {
  buildMissionDiffTree,
  formatDiffStatus,
  renderDiffPatch,
  renderDiffStats,
  type MissionDiffTreeNode,
} from "./diff-tree";
import { MissionPanelNav, type MissionPanelPage } from "./panels";

type MissionDisplayPanelProps = {
  style: CSSProperties;
  pages: MissionPanelPage[];
  selectedPage: MissionPanelPage;
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  diffCount: number;
  logCount: number;
  overviewItems: string[];
  noDiffSummary: string;
  logbookContent: ReactNode;
  collapsedDiffDirectories: ReadonlySet<string>;
  onAddPage: () => void;
  onSelectPage: (pageId: string) => void;
  onDragStart: (pageId: string | null) => void;
  onDrop: (pageId: string) => void;
  onOpenDiffDetail: (path: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
  onMovePage: (pageId: string, direction: -1 | 1) => void;
  onDeletePage: (pageId: string) => void;
  onToggleDiffDirectory: (path: string) => void;
};

export function MissionDisplayPanel({
  style,
  pages,
  selectedPage,
  selectedDiffFilePath,
  diffs,
  diffCount,
  logCount,
  overviewItems,
  noDiffSummary,
  logbookContent,
  collapsedDiffDirectories,
  onAddPage,
  onSelectPage,
  onDragStart,
  onDrop,
  onOpenDiffDetail,
  onRenamePage,
  onMovePage,
  onDeletePage,
  onToggleDiffDirectory,
}: MissionDisplayPanelProps) {
  const diffTree = buildMissionDiffTree(diffs);

  const renderDiffTreeNode = (
    node: MissionDiffTreeNode,
    depth = 0,
  ): ReactNode => {
    if (node.kind === "file" && node.file) {
      const file = node.file;
      return (
        <button
          key={node.id}
          type="button"
          className="mission-file-row mission-file-row-compact mission-file-row-button"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => onOpenDiffDetail(file.path)}
        >
          <span className={`mission-file-status status-${file.status}`}>
            {formatDiffStatus(file.status)}
          </span>
          <strong>{node.name}</strong>
          {renderDiffStats(file)}
        </button>
      );
    }

    const collapsed = collapsedDiffDirectories.has(node.path);
    return (
      <section
        key={node.id}
        className={`mission-change-group ${collapsed ? "collapsed" : ""}`}
      >
        <button
          type="button"
          className="mission-change-group-title"
          style={{ paddingLeft: `${2 + depth * 14}px` }}
          onClick={() => onToggleDiffDirectory(node.path)}
          aria-expanded={!collapsed}
        >
          <span>{collapsed ? "▸" : "▾"}</span>
          <span>{node.name}</span>
          <span className="mission-change-count">{node.count}</span>
        </button>
        {!collapsed
          ? node.children?.map((child) => renderDiffTreeNode(child, depth + 1))
          : null}
      </section>
    );
  };

  const renderSelectedPage = () => {
    if (selectedPage.id === "changes") {
      return (
        <div className="mission-panel-page mission-change-tree">
          {diffTree.length ? (
            diffTree.map((node) => renderDiffTreeNode(node))
          ) : (
            <div className="empty-state">{noDiffSummary}</div>
          )}
        </div>
      );
    }

    if (selectedPage.id === "diff-detail") {
      return (
        <div className="mission-panel-page mission-diff-detail">
          {diffs.length ? (
            diffs.map((file) => (
              <details
                key={file.path}
                className={`mission-diff-file ${selectedDiffFilePath === file.path ? "active" : ""}`}
              >
                <summary className="mission-file-row mission-diff-file-summary">
                  <span className={`mission-file-status status-${file.status}`}>
                    {formatDiffStatus(file.status)}
                  </span>
                  <strong>{file.path}</strong>
                  {renderDiffStats(file)}
                  <span className="mission-diff-expand-icon" aria-hidden="true">
                    ▸
                  </span>
                </summary>
                {file.patch ? (
                  renderDiffPatch(file.patch)
                ) : (
                  <div className="mission-diff-patch-empty">
                    该 diff 事件没有携带 patch/hunk 内容。
                  </div>
                )}
              </details>
            ))
          ) : (
            <div className="empty-state">{noDiffSummary}</div>
          )}
        </div>
      );
    }

    if (selectedPage.id === "logbook") {
      return (
        <div className="mission-panel-page mission-logbook-page">
          {logbookContent}
        </div>
      );
    }

    if (selectedPage.id.startsWith("custom-")) {
      return (
        <div className="mission-panel-page mission-custom-page">
          <div className="mission-custom-page-tools">
            <label>
              <span>展示页名称</span>
              <input
                value={selectedPage.title}
                onChange={(event) =>
                  onRenamePage(selectedPage.id, event.target.value)
                }
              />
            </label>
            <div className="mission-custom-page-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => onMovePage(selectedPage.id, -1)}
              >
                上移
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => onMovePage(selectedPage.id, 1)}
              >
                下移
              </button>
              <button
                className="secondary danger-button"
                type="button"
                onClick={() => onDeletePage(selectedPage.id)}
              >
                删除展示页
              </button>
            </div>
          </div>
          <div className="empty-state">
            自定义展示页占位，可继续挂载文件树、预览、测试结果或工具输出。
          </div>
        </div>
      );
    }

    return (
      <div className="mission-panel-page mission-overview-page">
        <InfoList
          title="项目信息"
          items={overviewItems}
          empty="选择左侧任务后显示项目信息"
        />
      </div>
    );
  };

  return (
    <aside
      className="mission-display-panel mission-pane mission-pane-display"
      style={style}
      aria-label="任务展示容器"
    >
      <div className="mission-panel-head">
        <div>
          <p className="eyebrow">展示</p>
          <h3>任务展示</h3>
        </div>
        <button
          className="mission-panel-add"
          type="button"
          onClick={onAddPage}
          aria-label="增加展示页"
        >
          ＋
        </button>
      </div>
      <div className="mission-panel-body">
        <MissionPanelNav
          pages={pages}
          selectedPageId={selectedPage.id}
          onSelect={onSelectPage}
          onDragStart={onDragStart}
          onDrop={onDrop}
        />
        <section className="mission-panel-content">
          {renderSelectedPage()}
        </section>
      </div>
    </aside>
  );
}
