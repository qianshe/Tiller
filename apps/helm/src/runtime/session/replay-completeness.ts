import type { AgentMessage, SessionReplayCompleteness } from "@tiller/shared";
import { looksLikeContinuationSummary } from "@tiller/shared";

const FULL_REPLAY_PROVIDER_ALLOWLIST = new Set<string>([]);

export function classifyReplayCompleteness(input: {
  restoreMethod: "session/load" | "session/resume";
  replayMessages: AgentMessage[];
  providerId: string;
}): SessionReplayCompleteness {
  if (input.restoreMethod === "session/resume") {
    return "none";
  }
  if (input.replayMessages.some((message) => looksLikeContinuationSummary(message.text))) {
    return "compacted";
  }
  if (FULL_REPLAY_PROVIDER_ALLOWLIST.has(input.providerId)) {
    return "full";
  }
  return "unknown";
}
