import { createHash } from "node:crypto";
import type { AcpAgentProvider, SessionReasoningEffort, WorktreeSummary } from "@tiller/shared";

export type AcpConnectionKey = string;

export type AcpConnectionKeyInput = {
  provider: AcpAgentProvider;
  worktree: WorktreeSummary;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
};

export function resolveAcpConnectionKey({ provider, worktree, sessionConfig }: AcpConnectionKeyInput): AcpConnectionKey {
  const payload = stableStringify({
    providerId: provider.id,
    cwd: worktree.path,
    command: provider.command,
    args: provider.args ?? [],
    providerCwd: provider.cwd ?? null,
    env: provider.env ?? {},
    mcpServers: provider.mcpServers ?? [],
    sessionConfig: normalizeSessionConfig(sessionConfig),
  });
  return `acp:${provider.id}:${hashKeyPayload(payload)}`;
}

function normalizeSessionConfig(sessionConfig: AcpConnectionKeyInput["sessionConfig"]) {
  if (!sessionConfig?.agentMode && !sessionConfig?.model && !sessionConfig?.reasoningEffort) {
    return null;
  }
  return {
    agentMode: sessionConfig.agentMode ?? null,
    model: sessionConfig.model ?? null,
    reasoningEffort: sessionConfig.reasoningEffort ?? null,
  };
}

function hashKeyPayload(payload: string) {
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
