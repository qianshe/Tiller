import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch } from "../shared";
import { applyCodexSessionLaunchArgs } from "../session-config";
import { mapCodexPlanUpdate } from "./plan-events";
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
    mapSessionUpdate: mapCodexPlanUpdate,
    normalizeToolCall: ({ toolCall, update }) => normalizeCodexToolCall(toolCall, update),
    resolveCompactionDetailsVisibility: () => "hidden",
  };
}
