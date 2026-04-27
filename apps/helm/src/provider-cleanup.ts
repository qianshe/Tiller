import { execFileSync } from "node:child_process";
import type { AcpAgentProvider } from "@tiller/shared";
import type { ProviderCleanupResult } from "@tiller/acp-runtime";

export type ProviderCleanupPlan =
  | { kind: "remote-delete"; command: string; args: string[]; providerId: string; runtimeSessionId: string }
  | { kind: "unsupported"; providerId: string; message: string };

type CleanupExecutor = {
  exec?: (command: string, args: string[]) => string;
};

export function resolveProviderCleanupPlan(provider: AcpAgentProvider, runtimeSessionId: string): ProviderCleanupPlan {
  if (provider.command === "opencode") {
    const pureArgs = provider.args?.includes("--pure") ? ["--pure"] : [];
    return {
      kind: "remote-delete",
      providerId: provider.id,
      runtimeSessionId,
      command: "opencode",
      args: ["session", "delete", runtimeSessionId, ...pureArgs],
    };
  }

  if (provider.command === "codex-acp" || provider.id === "codex") {
    return {
      kind: "unsupported",
      providerId: provider.id,
      message: "Codex ACP does not expose remote session deletion yet.",
    };
  }

  return {
    kind: "unsupported",
    providerId: provider.id,
    message: `${provider.name} does not expose remote session deletion yet.`,
  };
}

export function executeProviderCleanup(provider: AcpAgentProvider, runtimeSessionId: string, executor: CleanupExecutor = {}): ProviderCleanupResult {
  const plan = resolveProviderCleanupPlan(provider, runtimeSessionId);
  if (plan.kind === "unsupported") {
    return {
      kind: "unsupported",
      providerId: plan.providerId,
      message: plan.message,
    };
  }

  const run = executor.exec ?? ((command: string, args: string[]) => String(execFileSync(command, args, { encoding: "utf8" })));

  try {
    run(plan.command, plan.args);
    return {
      kind: "remote-deleted",
      providerId: plan.providerId,
      message: `${provider.name} remote session deleted: ${runtimeSessionId}`,
    };
  } catch (error) {
    return {
      kind: "remote-delete-failed",
      providerId: plan.providerId,
      message: error instanceof Error ? error.message : `Failed to delete remote session ${runtimeSessionId}`,
    };
  }
}
