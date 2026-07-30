import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../../../handlers/context";
import { assertCanonicalTimelinePipeline } from "./canonical";
import { handleRuntimeCommandOutputEvent } from "./command-output";
import { handleRuntimeCompactionEvent } from "./compaction";
import { handleRuntimeAssistantMessage, handleRuntimeUserMessage } from "./message-stream";
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
import { handleRuntimeToolCallEvent } from "./tool-call";

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
      handleRuntimeAssistantMessage(sessionId, event, context);
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
