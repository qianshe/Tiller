import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionSummary } from "@tiller/shared";

export function createSessionBootstrapEvents(
  summary: SessionSummary,
): SessionRuntimeEvent[] {
  const events: SessionRuntimeEvent[] = [];
  if (
    summary.agentMode !== undefined ||
    summary.model !== undefined ||
    summary.reasoningEffort !== undefined ||
    (summary.configOptions?.length ?? 0) > 0
  ) {
    events.push({
      type: "config-options",
      state: {
        agentMode: summary.agentMode,
        model: summary.model,
        reasoningEffort: summary.reasoningEffort,
      },
      options: summary.configOptions ?? [],
    });
  }
  if (summary.modelOptions) {
    events.push({
      type: "model-options",
      state: {
        currentModelId: summary.model,
        options: summary.modelOptions,
      },
    });
  }
  if (summary.availableCommands) {
    events.push({
      type: "available-commands",
      commands: summary.availableCommands,
    });
  }
  events.push({ type: "status", status: summary.status });
  return events;
}
