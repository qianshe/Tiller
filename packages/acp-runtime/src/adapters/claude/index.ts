import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch, resolveUnsupportedCleanup } from "../shared";
import { createClaudePlanUpdateMapper } from "./plan-events";
import { readClaudeTranscriptMessagesFromDisk } from "./transcript/history";
import { readClaudeTranscriptPlanFromDisk } from "./transcript/plan";

const CLAUDE_ACP_COMMANDS = ["claude-acp", "claude-agent-acp", "claude-code-acp"];

export function createClaudeAcpAdapter(): AcpAgentAdapter {
  return {
    id: "claude",
    isMatch: (provider) => provider.id === "claude-acp" || provider.id === "claude-agent-acp" || CLAUDE_ACP_COMMANDS.some((command) => isCommandNamed(provider.command, command)),
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
    mapSessionUpdate: createClaudePlanUpdateMapper(),
    readTranscriptPlan: ({ runtimeSessionId, cwd }) =>
      readClaudeTranscriptPlanFromDisk({ runtimeSessionId, cwd }),
    readTranscriptMessages: ({ runtimeSessionId, cwd }) =>
      readClaudeTranscriptMessagesFromDisk({ runtimeSessionId, cwd }),
  };
}
