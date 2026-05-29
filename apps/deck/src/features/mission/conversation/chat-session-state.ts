import type {
  AgentMessage,
  AgentToolCall,
  PermissionRequest,
  SessionSummary,
} from "@tiller/shared";
import type { MissionToolLoadingState } from "./tool-loading";
import { resolveMissionActivityLoading } from "../utils/session-render-state";

export type ChatSessionMessageSources = {
  activeSessionId: string | null | undefined;
  activeSessionMessages: AgentMessage[];
  sessionMessagesById: Record<string, AgentMessage[] | undefined>;
};

export type ChatSessionToolCallSources = {
  activeSessionId: string | null | undefined;
  activeSessionToolCalls: AgentToolCall[];
  sessionToolCallsById: Record<string, AgentToolCall[] | undefined>;
};

export type ChatSessionToolLoadingSources =
  & ChatSessionMessageSources
  & ChatSessionToolCallSources
  & {
    activityLoading: MissionToolLoadingState["activity"] | null;
    pendingToolPresent: boolean;
    pendingApprovals: ReadonlyArray<{
      sessionId: string;
      request: PermissionRequest;
    }>;
  };

export function resolveChatSessionMessages(
  session: SessionSummary,
  sources: ChatSessionMessageSources,
): AgentMessage[] {
  return sources.sessionMessagesById[session.id]
    ?? (session.id === sources.activeSessionId ? sources.activeSessionMessages : []);
}

export function resolveChatSessionToolCalls(
  session: SessionSummary,
  sources: ChatSessionToolCallSources,
): AgentToolCall[] {
  return sources.sessionToolCallsById[session.id]
    ?? (session.id === sources.activeSessionId ? sources.activeSessionToolCalls : []);
}

export function resolveChatSessionToolLoading(
  session: SessionSummary,
  sources: ChatSessionToolLoadingSources,
): MissionToolLoadingState | undefined {
  const sessionMessages = resolveChatSessionMessages(session, sources);
  const sessionToolCalls = resolveChatSessionToolCalls(session, sources);
  if (session.id === sources.activeSessionId && sources.activityLoading) {
    return {
      activity: sources.activityLoading,
      pendingToolPresent: sources.pendingToolPresent,
    };
  }

  const sessionActivityLoading = resolveMissionActivityLoading({
    status: session.status,
    messages: sessionMessages,
    toolCalls: sessionToolCalls,
    pendingPermission: sources.pendingApprovals.find(
      (approval) => approval.sessionId === session.id,
    )?.request ?? null,
  });

  return sessionActivityLoading
    ? {
        activity: sessionActivityLoading,
        pendingToolPresent: sessionActivityLoading.title.startsWith("Tool:"),
      }
    : undefined;
}
