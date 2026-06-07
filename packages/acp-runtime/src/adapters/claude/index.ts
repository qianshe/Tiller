import type { AcpAgentAdapter } from "../types";
import { loadProviderAuthoritativeHistory } from "../history-reader";
import { isCommandNamed, resolveDefaultLaunch, resolveUnsupportedCleanup } from "../shared";
import { claudeCodeHistoryReader } from "./history";
import { createClaudePlanUpdateMapper } from "./plan-events";

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
    loadAuthoritativeHistory: (context) =>
      loadProviderAuthoritativeHistory(claudeCodeHistoryReader, context),
  };
}
