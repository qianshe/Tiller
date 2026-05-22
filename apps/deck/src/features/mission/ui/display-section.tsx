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
  overviewItems: string[];
  runtimeOverviewItems: RuntimeOverviewItem[];
  currentModelSummary?: string | null;
  openedDiffFilePaths: string[];
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  noDiffSummary: string;
  onReconnectRuntime?: (runtime: RuntimeOverviewItem) => void;
  activeSession: SessionSummary | null;
  sessionToolCalls: AgentToolCall[];
  commandChunks: CommandChunk[];
  sessionMessages: AgentMessage[];
  historyState?: ActivityHistoryState;
  visibleCount: number;
  visibleLimit: number;
  copy: MissionDisplaySectionCopy;
  onShowMore: (sessionId: string, nextVisibleCount: number) => void;
  onLoadOlder: (sessionId: string) => void;
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

/**
 * Wires the mission display panel with its logbook page content.
 */
export function MissionDisplaySection({
  style,
  pages,
  selectedPage,
  overviewItems,
  runtimeOverviewItems,
  currentModelSummary,
  openedDiffFilePaths,
  selectedDiffFilePath,
  diffs,
  noDiffSummary,
  onReconnectRuntime,
  activeSession,
  sessionToolCalls,
  commandChunks,
  sessionMessages,
  historyState,
  visibleCount,
  visibleLimit,
  copy,
  onShowMore,
  onLoadOlder,
  onAddPage,
  onSelectPage,
  onDragStart,
  onDrop,
  onRenamePage,
  onMovePage,
  onDeletePage,
  onOpenDiffDetail,
  onCloseDiffFile,
  onCollapse,
}: MissionDisplaySectionProps) {
  return (
    <MissionDisplayPanel
      style={style}
      pages={pages}
      selectedPage={selectedPage}
      overviewItems={overviewItems}
      runtimeOverviewItems={runtimeOverviewItems}
      currentModelSummary={currentModelSummary}
      openedDiffFilePaths={openedDiffFilePaths}
      selectedDiffFilePath={selectedDiffFilePath}
      diffs={diffs}
      noDiffSummary={noDiffSummary}
      onReconnectRuntime={onReconnectRuntime}
      logbookContent={
        <LogbookPanel
          activeSession={activeSession}
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
      onAddPage={onAddPage}
      onSelectPage={onSelectPage}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onRenamePage={onRenamePage}
      onMovePage={onMovePage}
      onDeletePage={onDeletePage}
      onOpenDiffDetail={onOpenDiffDetail}
      onCloseDiffFile={onCloseDiffFile}
      onCollapse={onCollapse}
    />
  );
}
