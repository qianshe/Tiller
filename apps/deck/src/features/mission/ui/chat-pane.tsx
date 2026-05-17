import type {
  AgentMessage,
  AgentToolCall,
  PermissionDecision,
  PermissionRequest,
  SessionPromptQueueSnapshot,
  SessionSummary,
} from "@tiller/shared";
import type {
  ComponentProps,
  CSSProperties,
  ReactNode,
  RefObject,
  UIEventHandler,
} from "react";
import type { UI_COPY, Locale } from "../../../shared/utils/copy";
import { useMemo } from "react";
import { MissionMessageTimeline } from "./message-timeline";
import { MissionPermissionDrawer } from "./permission-drawer";
import { MissionQueuedPrompts } from "./queued-prompts";
import { MissionToolLoading } from "./tool-loading";

type MissionChatPaneCopy = (typeof UI_COPY)[Locale];
type MissionToolActivity = ComponentProps<typeof MissionToolLoading>["activity"];

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
};

type MissionChatPaneProps = {
  className: string;
  style: CSSProperties;
  chatMainRef: RefObject<HTMLDivElement | null>;
  onChatMainScroll: UIEventHandler<HTMLDivElement>;
  helmConnected: boolean;
  activeSession: SessionSummary | null;
  activeSessionMessages: AgentMessage[];
  activeSessionToolCalls: AgentToolCall[];
  copy: MissionChatPaneCopy;
  expandedMessageIds: ReadonlySet<string>;
  messageHistoryState: Record<string, HistoryState | undefined>;
  activityHistoryState: Record<string, HistoryState | undefined>;
  onLoadOlderMessages: (sessionId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  activityLoading: MissionToolActivity | null;
  pendingToolPresent: boolean;
  pendingApprovals: ReadonlyArray<{
    request: PermissionRequest;
    resolving: boolean;
  }>;
  pendingToolTitle: string | null;
  showPermissionWorktree: boolean;
  onRespondToPermission: (approvalRequestId: string, decision: PermissionDecision) => void;
  promptQueue?: SessionPromptQueueSnapshot;
  onUpdateQueuedPrompt: (sessionId: string, queueItemId: string, text: string) => void;
  onDeleteQueuedPrompt: (sessionId: string, queueItemId: string) => void;
  children: ReactNode;
};

/**
 * Owns the mission conversation surface around timeline, permissions and composer.
 */
export function MissionChatPane({
  className,
  style,
  chatMainRef,
  onChatMainScroll,
  helmConnected,
  activeSession,
  activeSessionMessages,
  activeSessionToolCalls,
  copy,
  expandedMessageIds,
  messageHistoryState,
  activityHistoryState,
  onLoadOlderMessages,
  onToggleExpandedMessage,
  activityLoading,
  pendingToolPresent,
  pendingApprovals,
  pendingToolTitle,
  showPermissionWorktree,
  onRespondToPermission,
  promptQueue,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
  children,
}: MissionChatPaneProps) {
  const thinkingToolCalls = useMemo(
    () => activeSessionToolCalls.filter((toolCall) => toolCall.kind === "think"),
    [activeSessionToolCalls],
  );
  const boundaryTimestamps = useMemo(
    () => activeSessionToolCalls.map((toolCall) => toolCall.timestamp),
    [activeSessionToolCalls],
  );

  return (
    <div className={className} style={style} data-mission-mobile-pane="chat">
      <div
        className="chat-main min-h-0 flex-1 overflow-y-auto rounded-md bg-surface-sunken/70 p-3"
        ref={chatMainRef}
        onScroll={onChatMainScroll}
      >
        {!helmConnected ? (
          <div className="note-box compact-note mission-session-feedback mb-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
            <strong>Helm 未连接</strong>{" "}
            <p className="mt-1 text-muted-foreground">
              任务页会继续展示本地缓存；连接 Helm 后即可刷新项目、任务与文件。
            </p>{" "}
          </div>
        ) : null}{" "}
        {activeSession ? (
          <>
            <MissionMessageTimeline
              items={activeSessionMessages}
              thinkingToolCalls={thinkingToolCalls}
              boundaryTimestamps={boundaryTimestamps}
              sessionId={activeSession.id}
              assistantLabel={activeSession.agentName}
              copy={copy}
              expandedMessageIds={expandedMessageIds}
              historyStateBySession={messageHistoryState}
              activityHistoryStateBySession={activityHistoryState}
              onLoadOlderMessages={onLoadOlderMessages}
              onToggleExpandedMessage={onToggleExpandedMessage}
            />{" "}
            {activityLoading ? (
              <MissionToolLoading
                activity={activityLoading}
                pendingToolPresent={pendingToolPresent}
              />
            ) : null}{" "}
          </>
        ) : null}{" "}
      </div>{" "}
      {activeSession && pendingApprovals.length > 0 ? (
        <div className="mission-approval-stack grid gap-2">
          {pendingApprovals.map((approval) => (
            <MissionPermissionDrawer
              key={approval.request.id}
              request={approval.request}
              copy={copy}
              showWorktree={showPermissionWorktree}
              fallbackToolTitle={pendingToolTitle}
              resolving={approval.resolving}
              onRespond={(decision) => onRespondToPermission(approval.request.id, decision)}
            />
          ))}
        </div>
      ) : null}
      {activeSession ? (
        <MissionQueuedPrompts
          queue={promptQueue}
          onUpdate={onUpdateQueuedPrompt}
          onDelete={onDeleteQueuedPrompt}
        />
      ) : null}
      {children}
    </div>
  );
}
