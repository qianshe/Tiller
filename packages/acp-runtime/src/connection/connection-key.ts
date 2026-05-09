import { createHash } from "node:crypto";
import type { AcpAgentProvider, SessionReasoningEffort, WorkspaceSummary } from "@tiller/shared";

export type AcpConnectionKey = string;

export type AcpConnectionKeyInput = {
  provider: AcpAgentProvider;
  workspace: WorkspaceSummary;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
};

export function resolveAcpConnectionKey({ provider }: AcpConnectionKeyInput): AcpConnectionKey {
  const payload = stableStringify({
    providerId: provider.id,
    command: provider.command,
    args: provider.args ?? [],
    cwd: provider.cwd ?? null,
    env: provider.env ?? {},
    mcpServers: provider.mcpServers ?? [],
  });
  return `acp:${provider.id}:${hashKeyPayload(payload)}`;
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
