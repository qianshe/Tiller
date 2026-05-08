import type { SessionRuntimeEvent } from "./runtime-types.js";

export type RestoreReplayEventSink = {
  onEvent: (event: SessionRuntimeEvent) => void;
  setSuppressing: (suppressing: boolean) => void;
};

export function createRestoreReplayEventSink(
  forward: (event: SessionRuntimeEvent) => void,
  onSuppress?: (event: SessionRuntimeEvent) => void,
): RestoreReplayEventSink {
  let suppressing = false;

  return {
    onEvent(event) {
      if (suppressing && isAssistantMessageEvent(event)) {
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

function isAssistantMessageEvent(event: SessionRuntimeEvent) {
  return event.type === "message" && event.message.role === "assistant";
}
