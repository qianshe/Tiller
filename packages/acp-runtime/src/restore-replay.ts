import type { AgentMessage } from "@tiller/shared";
import type { SessionRuntimeEvent } from "./runtime-types.js";

export type RestoreReplayEventSink = {
  onEvent: (event: SessionRuntimeEvent) => void;
  setSuppressing: (suppressing: boolean) => void;
};

export function createRestoreReplayEventSink(
  forward: (event: SessionRuntimeEvent) => void,
  onSuppress?: (event: SessionRuntimeEvent) => void,
  baselineMessages: AgentMessage[] = [],
): RestoreReplayEventSink {
  let suppressing = false;
  const assistantBaseline = baselineMessages.filter((message) => message.role === "assistant");

  return {
    onEvent(event) {
      if (suppressing && isRestoreReplayEvent(event, assistantBaseline)) {
        onSuppress?.(event);
        return;
      }
      forward(event);
    },
    setSuppressing(nextSuppressing) {
      suppressing = nextSuppressing;
    },
  };
}

function isRestoreReplayEvent(event: SessionRuntimeEvent, assistantBaseline: AgentMessage[]) {
  if (isReplayMessage(event, assistantBaseline)) {
    return true;
  }
  return (
    event.type === "tool-call" ||
    event.type === "command-output" ||
    event.type === "diff-update" ||
    event.type === "plan-update" ||
    event.type === "compaction"
  );
}

function isReplayMessage(event: SessionRuntimeEvent, assistantBaseline: AgentMessage[]) {
  if (event.type !== "message") {
    return false;
  }
  if (event.message.role !== "assistant") {
    return true;
  }
  return isReplayAssistantMessage(event, assistantBaseline);
}

function isReplayAssistantMessage(
  event: SessionRuntimeEvent,
  baselineMessages: AgentMessage[],
) {
  return (
    event.type === "message" &&
    event.message.role === "assistant" &&
    (baselineMessages.length === 0 ||
      baselineMessages.some((message) => isSameAssistantReplay(message, event.message)))
  );
}

function isSameAssistantReplay(
  baseline: AgentMessage,
  incoming: AgentMessage,
) {
  if (baseline.id === incoming.id) {
    return true;
  }

  const baselineText = normalizeAssistantText(baseline.text);
  const incomingText = normalizeAssistantText(incoming.text);
  return Boolean(
    baselineText &&
      incomingText &&
      (baselineText === incomingText ||
        baselineText.includes(incomingText) ||
        incomingText.includes(baselineText)),
  );
}

function normalizeAssistantText(text: string) {
  return text.replace(/[\s\u00a0]+/gu, "").trim();
}
