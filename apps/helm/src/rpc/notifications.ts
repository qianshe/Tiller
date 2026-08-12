import type { NotificationRaisedParams } from "@tiller/sync-protocol";
import type { PromptTraceEvent, SessionActivitySummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

export function broadcastSessionUpdate(
  context: HelmHandlerContext,
  sessionId: string,
  update: unknown,
): void {
  const params = { sessionId, update };
  if (isSessionDetailUpdate(update)) {
    context.broadcastSessionTopic(sessionId, "session/update", params);
    return;
  }
  context.broadcastNotification("session/update", params);
}

export function broadcastConversationUpdate(
  context: Pick<HelmHandlerContext, "broadcastNotification">,
  update:
    | { kind: "preparation_updated"; preparation: unknown }
    | { kind: "preparation_deleted"; preparationId: string },
): void {
  context.broadcastNotification("conversation/update", update);
}

export function broadcastSessionActivitySummary(
  context: Pick<HelmHandlerContext, "broadcastNotification">,
  summary: SessionActivitySummary,
): void {
  context.broadcastNotification("dashboard/activity_summary", summary);
}

export function broadcastErrorRaised(
  context: HelmHandlerContext,
  input: Omit<NotificationRaisedParams, "kind" | "source" | "occurredAt"> & {
    source?: string;
    occurredAt?: string;
  },
): void {
  broadcastNotificationRaised(context, {
    ...input,
    kind: "error",
    source: input.source ?? "runtime",
  });
}

export function broadcastInfoRaised(
  context: Pick<HelmHandlerContext, "broadcastNotification">,
  input: Omit<NotificationRaisedParams, "kind" | "source" | "occurredAt"> & {
    source?: string;
    occurredAt?: string;
  },
): void {
  broadcastNotificationRaised(context, {
    ...input,
    kind: "info",
    source: input.source ?? "runtime",
  });
}

export function broadcastNotificationRaised(
  context: Pick<HelmHandlerContext, "broadcastNotification">,
  input: NotificationRaisedParams,
): void {
  context.broadcastNotification("notification/raised", {
    ...input,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
}

export function broadcastPromptTrace(
  context: Pick<HelmHandlerContext, "broadcastNotification">,
  event: PromptTraceEvent,
): void {
  context.broadcastNotification("debug/prompt_trace", event);
}

function isSessionDetailUpdate(update: unknown): boolean {
  if (!update || typeof update !== "object" || !("kind" in update)) {
    return false;
  }
  const kind = (update as { kind?: unknown }).kind;
  return kind === "agent_message"
    || kind === "tool_call"
    || kind === "timeline_batch"
    || kind === "live_state"
    || kind === "subagent_detail";
}
