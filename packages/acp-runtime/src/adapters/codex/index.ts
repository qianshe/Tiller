import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch } from "../shared";
import { applyCodexSessionLaunchArgs } from "../session-config";
import { buildCodexAuthoritativeHistoryFromEvents, codexHistoryReader } from "./history";
import { mapCodexPlanUpdate } from "./plan-events";

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
    loadAuthoritativeHistory: async (context) => {
      const source = await codexHistoryReader.read(context);
      return source
        ? buildCodexAuthoritativeHistoryFromEvents(
            codexHistoryReader.toEvents(source, context),
          )
        : null;
    },
  };
}
