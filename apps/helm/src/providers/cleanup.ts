import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AcpAgentProvider } from "@tiller/shared";
import type { ProviderCleanupResult } from "@tiller/acp-runtime";

export type ProviderCleanupPlan =
  | { kind: "remote-delete"; command: string; args: string[]; providerId: string; runtimeSessionId: string }
  | { kind: "unsupported"; providerId: string; message: string };

type CleanupExecutor = {
  exec?: (command: string, args: string[]) => string;
};

export function quoteWindowsCommandLine(command: string, args: string[]) {
  return [command, ...args].map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveWindowsCommand(command: string) {
  try {
    const resolved = execFileSync("where.exe", [command], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean)?.trim() ?? command;
    if (!resolved.includes(".") && existsSync(`${resolved}.cmd`)) {
      return `${resolved}.cmd`;
    }
    return resolved;
  } catch {
    return command;
  }
}

function runWindowsCleanupCommand(command: string, args: string[]) {
  const resolvedCommand = resolveWindowsCommand(command);
  if (resolvedCommand.toLowerCase().endsWith(".cmd")) {
    const cmdContent = readFileSync(resolvedCommand, "utf8");
    const scriptMatch = cmdContent.match(/"%_prog%"\s+"([^"]+)"\s+%\*/u);
    if (scriptMatch) {
      const scriptPath = scriptMatch[1].replace(/%dp0%/giu, dirname(resolvedCommand));
      return String(execFileSync("node", [resolve(scriptPath), ...args], { encoding: "utf8" }));
    }
  }

  return String(execFileSync(resolvedCommand, args, { encoding: "utf8" }));
}

function isCommandNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function runCleanupCommand(command: string, args: string[]) {
  try {
    return String(execFileSync(command, args, { encoding: "utf8" }));
  } catch (error) {
    if (process.platform !== "win32" || !isCommandNotFound(error)) {
      throw error;
    }

    return runWindowsCleanupCommand(command, args);
  }
}

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

  const run = executor.exec ?? runCleanupCommand;

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
