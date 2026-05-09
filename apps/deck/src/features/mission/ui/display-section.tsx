import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import type { CSSProperties } from "react";
import type { UI_COPY, Locale } from "../../../shared/utils/copy";
import { MissionDisplayPanel, type RuntimeOverviewItem } from "./display-panel";
import { LogbookPanel } from "./logbook-panel";
import type { MissionPanelPage } from "./panels";

type MissionDisplaySectionCopy = (typeof UI_COPY)[Locale];

type ActivityHistoryState = {
  hasMore?: boolean;
  loading?: boolean;
};

type MissionDisplaySectionProps = {
  style: CSSProperties;
  pages: MissionPanelPage[];
  selectedPage: MissionPanelPage;
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  diffCount: number;
  logCount: number;
  overviewItems: string[];
  runtimeOverviewItems: RuntimeOverviewItem[];
  noDiffSummary: string;
  activeSession: SessionSummary | null;
  statusLabel: string;
  sessionToolCalls: AgentToolCall[];
  commandChunks: CommandChunk[];
  sessionMessages: AgentMessage[];
  historyState?: ActivityHistoryState;
  visibleCount: number;
  visibleLimit: number;
  copy: MissionDisplaySectionCopy;
  collapsedDiffDirectories: ReadonlySet<string>;
  onShowMore: (sessionId: string, nextVisibleCount: number) => void;
  onLoadOlder: (sessionId: string) => void;
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

/**
 * Wires the mission display panel with its logbook page content.
 */
export function MissionDisplaySection({
  style,
  pages,
  selectedPage,
  selectedDiffFilePath,
  diffs,
  diffCount,
  logCount,
  overviewItems,
  runtimeOverviewItems,
  noDiffSummary,
  activeSession,
  statusLabel,
  sessionToolCalls,
  commandChunks,
  sessionMessages,
  historyState,
  visibleCount,
  visibleLimit,
  copy,
  collapsedDiffDirectories,
  onShowMore,
  onLoadOlder,
  onAddPage,
  onSelectPage,
  onDragStart,
  onDrop,
  onOpenDiffDetail,
  onRenamePage,
  onMovePage,
  onDeletePage,
  onToggleDiffDirectory,
}: MissionDisplaySectionProps) {
  return (
    <MissionDisplayPanel
      style={style}
      pages={pages}
      selectedPage={selectedPage}
      selectedDiffFilePath={selectedDiffFilePath}
      diffs={diffs}
      diffCount={diffCount}
      logCount={logCount}
      overviewItems={overviewItems}
      runtimeOverviewItems={runtimeOverviewItems}
      noDiffSummary={noDiffSummary}
      logbookContent={
        <LogbookPanel
          activeSession={activeSession}
          statusLabel={statusLabel}
          diffCount={diffCount}
          logCount={logCount}
          sessionToolCalls={sessionToolCalls}
          commandChunks={commandChunks}
          sessionMessages={sessionMessages}
          historyState={historyState}
          visibleCount={visibleCount}
          visibleLimit={visibleLimit}
          copy={copy}
          onShowMore={onShowMore}
          onLoadOlder={onLoadOlder}
        />
      }
      collapsedDiffDirectories={collapsedDiffDirectories}
      onAddPage={onAddPage}
      onSelectPage={onSelectPage}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onOpenDiffDetail={onOpenDiffDetail}
      onRenamePage={onRenamePage}
      onMovePage={onMovePage}
      onDeletePage={onDeletePage}
      onToggleDiffDirectory={onToggleDiffDirectory}
    />
  );
}
