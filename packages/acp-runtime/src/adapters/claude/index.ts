import type { AcpAgentAdapter } from "../types";
import {
  isCommandNamed,
  resolveDefaultLaunch,
  resolveUnsupportedCleanup,
} from "../shared";
import { createClaudePlanUpdateProjector } from "./plan-events";
import { createClaudePromptCompactionObserver } from "./prompt-compaction";
import { createClaudePromptPlanObserver } from "./prompt-plan";
import { createClaudePromptToolCallObserver } from "./prompt-tool-calls";
import { createClaudeToolEvidenceCollector } from "./evidence";
import { promptEventsToToolObservations } from "../../tool-recognition";
import { readClaudeTranscriptCompactionFromDisk } from "./transcript/history";
import { readClaudeTranscriptToolCallsFromDisk } from "./transcript/tool-calls";

const CLAUDE_ACP_COMMANDS = [
  "claude-acp",
  "claude-agent-acp",
  "claude-code-acp",
];

export function createClaudeAcpAdapter(): AcpAgentAdapter {
  const planProjector = createClaudePlanUpdateProjector();
  const promptPlans = createClaudePromptPlanObserver(
    (context, toolCalls) => planProjector.reconcileTaskUpdates(
      context.runtimeSessionId,
      toolCalls,
    ),
  );
  const toolEvidence = createClaudeToolEvidenceCollector();
  const promptToolCalls = createClaudePromptToolCallObserver(
    undefined,
    readClaudeTranscriptToolCallsFromDisk,
  );
  const promptCompactions = createClaudePromptCompactionObserver();
  return {
    id: "claude",
    isMatch: (provider) =>
      provider.id === "claude" ||
      provider.id === "claudecode" ||
      provider.id === "claude-acp" ||
      provider.id === "claude-agent-acp" ||
      CLAUDE_ACP_COMMANDS.some((command) =>
        isCommandNamed(provider.command, command),
      ),
    resolveLaunch: (provider, context) => {
      const launch = resolveDefaultLaunch(provider, context);
      return {
        ...launch,
        env: {
          // Match Zed's registry-agent boundary: Claude ACP auth belongs to the agent,
          // not to Tiller/Deck. Keep the variable present without inventing a key.
          ANTHROPIC_API_KEY: "",
          ...launch.env,
        },
      };
    },
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider }) => resolveUnsupportedCleanup(provider),
    beginPromptObservation: (context) => {
      promptToolCalls.begin(context);
      promptCompactions.begin(context);
    },
    pollPromptToolObservations: (context) =>
      promptEventsToToolObservations(promptToolCalls.poll(context), {
        providerId: "claude",
        sessionId: context.runtimeSessionId,
        cwd: context.cwd,
      }),
    pollPromptRuntimeEvents: (context) => [
      ...promptPlans.poll(context),
      ...promptCompactions.poll(context),
    ],
    mapToolCallUpdate: planProjector.mapUpdate,
    disposeSession: (sessionId) => {
      planProjector.disposeSession(sessionId);
      promptPlans.dispose(sessionId);
      toolEvidence.disposeSession(sessionId);
      promptToolCalls.dispose(sessionId);
      promptCompactions.dispose(sessionId);
    },
    collectToolEvidence: toolEvidence.collect,
    resolveCompactionSummary: (context) =>
      readClaudeTranscriptCompactionFromDisk(context),
  };
}
