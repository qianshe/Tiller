import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch } from "../shared";
import { applyCodexSessionLaunchArgs } from "../session-config";
import { expandCodexRuntimeEvent, summarizeCodexCompactionSignal } from "./compaction-events";
import { extractCodexPlanFromToolCall, isCodexPlanToolCall } from "./plan-events";
import { mapCodexSessionUpdate } from "./session-updates";
import { readCodexTranscriptMessagesFromDisk } from "./transcript/history";
import { readCodexTranscriptPlanFromDisk } from "./transcript/plan";
import { readCodexTranscriptToolCallsFromDisk } from "./transcript/tool-calls";
import { normalizeCodexToolCall } from "./tool-calls";

export function createCodexAcpAdapter(): AcpAgentAdapter {
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
    mapSessionUpdate: mapCodexSessionUpdate,
    expandRuntimeEvent: expandCodexRuntimeEvent,
    normalizeToolCall: ({ toolCall, update }) => normalizeCodexToolCall(toolCall, update),
    readTranscriptPlan: ({ runtimeSessionId, cwd }) =>
      readCodexTranscriptPlanFromDisk({ runtimeSessionId, cwd }),
    readTranscriptMessages: ({ runtimeSessionId, cwd }) =>
      readCodexTranscriptMessagesFromDisk({ runtimeSessionId, cwd }),
    readTranscriptToolCalls: ({ runtimeSessionId, cwd }) =>
      readCodexTranscriptToolCallsFromDisk({ runtimeSessionId, cwd }),
    extractPlanFromToolCall: extractCodexPlanFromToolCall,
    isPlanToolCall: isCodexPlanToolCall,
    summarizeCompactionSignal: summarizeCodexCompactionSignal,
    resolveCompactionDetailsVisibility: () => "hidden",
  };
}
