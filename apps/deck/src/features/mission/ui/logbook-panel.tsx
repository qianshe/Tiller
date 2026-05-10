import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  SessionSummary,
} from "@tiller/shared";
import { ActivityLogPanel } from "../../logbook/ui/activity-log-panel";
import { SessionOverviewCard } from "./session-overview-card";

type ActivityHistoryState = {
  hasMore?: boolean;
  loading?: boolean;
};

type LogbookPanelCopy = {
  commandOutput: string;
  noCommandOutput: string;
};

type LogbookPanelProps = {
  activeSession: SessionSummary | null;
  statusLabel: string;
  diffCount: number;
  logCount: number;
  sessionToolCalls: AgentToolCall[];
  commandChunks: CommandChunk[];
  sessionMessages: AgentMessage[];
  historyState?: ActivityHistoryState;
  visibleCount: number;
  visibleLimit: number;
  copy: LogbookPanelCopy;
  onShowMore: (sessionId: string, nextVisibleCount: number) => void;
  onLoadOlder: (sessionId: string) => void;
};

/**
 * Combines session metrics and activity timeline for the mission logbook page.
 */
export function LogbookPanel({
  activeSession,
  statusLabel,
  diffCount,
  logCount,
  sessionToolCalls,
  commandChunks,
  sessionMessages,
  historyState,
  visibleCount,
  visibleLimit,
  copy,
  onShowMore,
  onLoadOlder,
}: LogbookPanelProps) {
  return (
    <div className="mission-logbook-layout grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="mission-logbook-summary min-h-0">
        <SessionOverviewCard
          activeSession={activeSession}
          statusLabel={statusLabel}
          diffCount={diffCount}
          logCount={logCount}
        />
      </div>
      <div
        className="mission-logbook-scroll min-h-0 overflow-auto pr-1"
        data-mission-swipe-lock="true"
      >
        <ActivityLogPanel
          sessionId={activeSession?.id}
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
      </div>
    </div>
  );
}
