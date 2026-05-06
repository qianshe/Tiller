import type {
  AgentMessage,
  PermissionDecision,
  PermissionRequest,
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
import { MissionMessageTimeline } from "./message-timeline";
import { MissionPermissionDrawer } from "./permission-drawer";
import { MissionToolLoading } from "./tool-loading";

type MissionChatPaneCopy = (typeof UI_COPY)[Locale];
type MissionToolActivity = ComponentProps<typeof MissionToolLoading>["activity"];

type MessageHistoryState = {
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
  copy: MissionChatPaneCopy;
  expandedMessageIds: ReadonlySet<string>;
  messageHistoryState: Record<string, MessageHistoryState | undefined>;
  onLoadOlderMessages: (sessionId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  activityLoading: MissionToolActivity | null;
  pendingToolPresent: boolean;
  pendingPermission: PermissionRequest | null;
  pendingToolTitle: string | null;
  showPermissionWorkspace: boolean;
  onRespondToPermission: (decision: PermissionDecision) => void;
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
  copy,
  expandedMessageIds,
  messageHistoryState,
  onLoadOlderMessages,
  onToggleExpandedMessage,
  activityLoading,
  pendingToolPresent,
  pendingPermission,
  pendingToolTitle,
  showPermissionWorkspace,
  onRespondToPermission,
  children,
}: MissionChatPaneProps) {
  return (
    <div className={className} style={style}>
      <div className="chat-main" ref={chatMainRef} onScroll={onChatMainScroll}>
        {!helmConnected ? (
          <div className="note-box compact-note mission-session-feedback">
            <strong>Helm 未连接</strong>{" "}
            <p>
              任务页会继续展示本地缓存；连接 Helm 后即可刷新项目、任务与文件。
            </p>{" "}
          </div>
        ) : null}{" "}
        {activeSession ? (
          <>
            <MissionMessageTimeline
              items={activeSessionMessages}
              sessionId={activeSession.id}
              assistantLabel={activeSession.agentName}
              copy={copy}
              expandedMessageIds={expandedMessageIds}
              historyStateBySession={messageHistoryState}
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
      {activeSession && pendingPermission ? (
        <MissionPermissionDrawer
          request={pendingPermission}
          copy={copy}
          showWorkspace={showPermissionWorkspace}
          fallbackToolTitle={pendingToolTitle}
          onRespond={onRespondToPermission}
        />
      ) : null}
      {children}
    </div>
  );
}
