import type { PromptTraceEvent } from "@tiller/shared";
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

export function broadcastErrorRaised(
  context: HelmHandlerContext,
  input: { sessionId?: string; code?: string; message: string; data?: unknown },
): void {
  context.broadcastNotification("error/raised", input);
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
  return kind === "user_message"
    || kind === "agent_message"
    || kind === "tool_call"
    || kind === "plan_update"
    || kind === "command_output"
    || kind === "compaction_state"
    || kind === "transcript_event"
    || kind === "timeline_batch"
    || kind === "live_state"
    || kind === "diff_update";
}
