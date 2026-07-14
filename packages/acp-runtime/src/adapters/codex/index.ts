import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch } from "../shared";
import { applyCodexSessionLaunchArgs } from "../session-config";
import { expandCodexRuntimeEvent, mapCodexCompactionUpdate, summarizeCodexCompactionSignal } from "./compaction-events";
import { extractCodexPlanFromToolCall, isCodexPlanToolCall, mapCodexPlanUpdate } from "./plan-events";
import { normalizeCodexToolCall } from "./tool-calls";
import { createCodexPromptToolCallObserver } from "./prompt-tool-calls";

export function createCodexAcpAdapter(): AcpAgentAdapter {
  const promptToolCalls = createCodexPromptToolCallObserver();
  return {
    id: "codex",
    isMatch: (provider) => provider.id === "codex" || isCommandNamed(provider.command, "codex-acp"),
    resolveLaunch: (provider, context) => {
      const launch = resolveDefaultLaunch(provider, context);
      return {
        ...launch,
        args: applyCodexSessionLaunchArgs(launch.args, context.sessionConfig),
      };
    },
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider }) => ({
      kind: "unsupported",
      providerId: provider.id,
      message: "Codex ACP does not expose remote session deletion yet.",
    }),
    mapMessageUpdate: mapCodexCompactionUpdate,
    mapToolCallUpdate: mapCodexPlanUpdate,
    beginPromptObservation: (context) => promptToolCalls.begin(context),
    pollPromptEvents: (context) => promptToolCalls.poll(context),
    disposeSession: (sessionId) => promptToolCalls.dispose(sessionId),
    expandRuntimeEvent: expandCodexRuntimeEvent,
    normalizeToolCall: ({ toolCall, update }) => normalizeCodexToolCall(toolCall, update),
    extractPlanFromToolCall: extractCodexPlanFromToolCall,
    isPlanToolCall: isCodexPlanToolCall,
    summarizeCompactionSignal: summarizeCodexCompactionSignal,
    resolveCompactionDetailsVisibility: () => "hidden",
  };
}
