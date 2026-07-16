import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch } from "../shared";
import { applyCodexSessionLaunchArgs } from "../session-config";
import { expandCodexRuntimeEvent, mapCodexCompactionUpdate, summarizeCodexCompactionSignal } from "./compaction-events";
import { extractCodexPlanFromToolCall, isCodexPlanToolCall, mapCodexPlanUpdate } from "./plan-events";
import { createCodexPromptToolCallObserver } from "./prompt-tool-calls";
import { collectCodexToolEvidence } from "./evidence";
import { promptEventsToToolObservations } from "../../tool-recognition";

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
    pollPromptToolObservations: (context) => promptEventsToToolObservations(
      promptToolCalls.poll(context),
      { providerId: "codex", sessionId: context.runtimeSessionId, cwd: context.cwd },
    ),
    disposeSession: (sessionId) => promptToolCalls.dispose(sessionId),
    expandRuntimeEvent: expandCodexRuntimeEvent,
    collectToolEvidence: collectCodexToolEvidence,
    extractPlanFromToolCall: extractCodexPlanFromToolCall,
    isPlanToolCall: isCodexPlanToolCall,
    summarizeCompactionSignal: summarizeCodexCompactionSignal,
    resolveCompactionDetailsVisibility: () => "hidden",
  };
}
