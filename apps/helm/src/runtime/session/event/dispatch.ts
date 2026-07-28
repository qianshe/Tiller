import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../../../handlers/context";
import { assertCanonicalTimelinePipeline } from "./canonical";
import { handleRuntimeCommandOutputEvent } from "./command-output";
import { handleRuntimeCompactionEvent } from "./compaction";
import {
  handleRuntimeAssistantMessage,
  handleRuntimeUserMessage,
} from "./message-stream";
import {
  handleRuntimeAvailableCommandsEvent,
  handleRuntimeCanonicalStateEvent,
  handleRuntimeConfigOptionsEvent,
  handleRuntimeDiffEvent,
  handleRuntimeErrorEvent,
  handleRuntimeModelOptionsEvent,
  handleRuntimePermissionEvent,
  handleRuntimePlanEvent,
  handleRuntimeStatusEvent,
} from "./state-handlers";
import {
  finalizeRuntimeThinking,
  handleRuntimeToolCallEvent,
} from "./tool-call";
import { shouldFlushActiveAssistantSegment } from "../../segment-state";

export function dispatchNormalizedRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  switch (event.type) {
    case "status":
      handleRuntimeStatusEvent(sessionId, event, context);
      return;
    case "message":
      if (event.message.role === "user") {
        handleRuntimeUserMessage(sessionId, event, context);
        return;
      }
      // A provider-finalized assistant message can carry a different source
      // id from the preceding assistant segment. Finalize Thinking before
      // message handling can rotate that segment and clear its runtime state.
      if (
        event.message.streaming !== true &&
        shouldFlushActiveAssistantSegment(sessionId, event.message.id)
      ) {
        finalizeRuntimeThinking(sessionId, "completed", context);
      }
      if (
        handleRuntimeAssistantMessage(sessionId, event, context) ||
        event.message.streaming !== true
      ) {
        finalizeRuntimeThinking(sessionId, "completed", context);
      }
      return;
    case "compaction":
      handleRuntimeCompactionEvent(sessionId, event, context);
      return;
    case "permission-request":
      handleRuntimePermissionEvent(sessionId, event, context);
      return;
    case "plan-update":
      handleRuntimePlanEvent(sessionId, event, context);
      return;
    case "tool-call":
      handleRuntimeToolCallEvent(sessionId, event, context);
      return;
    case "command-output":
      handleRuntimeCommandOutputEvent(sessionId, event, context);
      return;
    case "diff-update":
      handleRuntimeDiffEvent(sessionId, event, context);
      return;
    case "config-options":
      handleRuntimeConfigOptionsEvent(sessionId, event, context);
      return;
    case "model-options":
      handleRuntimeModelOptionsEvent(sessionId, event, context);
      return;
    case "available-commands":
      handleRuntimeAvailableCommandsEvent(sessionId, event, context);
      return;
    case "mode-update":
    case "session-info":
    case "usage-update":
      handleRuntimeCanonicalStateEvent(sessionId, event, context);
      return;
    case "error":
      handleRuntimeErrorEvent(sessionId, event, context);
      return;
    case "permission-response":
      return;
    default: {
      const unhandledEvent: never = event;
      return unhandledEvent;
    }
  }
}
