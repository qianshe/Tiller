import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
} from "@tiller/shared";

export type ProviderHistorySourceKind = "acp-session-load" | "adapter-authoritative-history" | "local-cache";

export type ProviderHistorySnapshotContent = {
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  plan?: AgentPlan;
};

export type ProviderHistorySnapshot = ProviderHistorySnapshotContent & {
  source: ProviderHistorySourceKind;
  syncedAt: string;
};

export type ProviderHistoryCandidate = {
  source: ProviderHistorySourceKind;
  load: () => Promise<ProviderHistorySnapshotContent | null>;
};

export function createHistorySnapshot(
  input: ProviderHistorySnapshotContent & { source: ProviderHistorySourceKind },
): ProviderHistorySnapshot {
  return {
    ...input,
    syncedAt: new Date().toISOString(),
  };
}

export async function resolveProviderHistorySnapshot(
  candidates: ProviderHistoryCandidate[],
): Promise<ProviderHistorySnapshot | null> {
  for (const candidate of candidates) {
    const content = await candidate.load();
    if (content) {
      return createHistorySnapshot({
        source: candidate.source,
        ...content,
      });
    }
  }

  return null;
}
