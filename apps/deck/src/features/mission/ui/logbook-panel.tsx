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
    <>
      <SessionOverviewCard
        activeSession={activeSession}
        statusLabel={statusLabel}
        diffCount={diffCount}
        logCount={logCount}
      />
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
    </>
  );
}
