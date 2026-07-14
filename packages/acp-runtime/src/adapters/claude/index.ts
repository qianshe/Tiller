import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch, resolveUnsupportedCleanup } from "../shared";
import { createClaudeToolCallNormalizer } from "./tool-calls";
import { createClaudePlanUpdateProjector } from "./plan-events";
import { createClaudePromptToolCallObserver } from "./prompt-tool-calls";

const CLAUDE_ACP_COMMANDS = ["claude-acp", "claude-agent-acp", "claude-code-acp"];

export function createClaudeAcpAdapter(): AcpAgentAdapter {
  const planProjector = createClaudePlanUpdateProjector();
  const toolCallNormalizer = createClaudeToolCallNormalizer();
  const promptToolCalls = createClaudePromptToolCallObserver();
  return {
    id: "claude",
    isMatch: (provider) =>
      provider.id === "claude" ||
      provider.id === "claudecode" ||
      provider.id === "claude-acp" ||
      provider.id === "claude-agent-acp" ||
      CLAUDE_ACP_COMMANDS.some((command) => isCommandNamed(provider.command, command)),
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
    beginPromptObservation: (context) => promptToolCalls.begin(context),
    pollPromptEvents: (context) => promptToolCalls.poll(context),
    mapToolCallUpdate: planProjector.mapUpdate,
    disposeSession: (sessionId) => {
      planProjector.disposeSession(sessionId);
      toolCallNormalizer.disposeSession(sessionId);
      promptToolCalls.dispose(sessionId);
    },
    normalizeToolCall: ({ toolCall, update, sessionId, cwd }) =>
      toolCallNormalizer.normalize(toolCall, update, sessionId, cwd),
  };
}
