import type {
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";

const AGENT_MODEL_OPTIONS_CACHE_KEY = "tiller.agent-model-options-cache";
const AGENT_MODEL_OPTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type AgentModelOptionsEntry = {
  loading?: boolean;
  warmed?: boolean;
  message?: string;
  /** projectId used when probing, echoed back for cache-key reconstruction. */
  projectId?: string | null;
  runtimeSessionId?: string;
  modelOptions: AcpModelOption[];
  configOptions: SessionConfigOption[];
  state: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
};

type AgentModelOptionsCache = Record<
  string,
  AgentModelOptionsEntry & { cachedAt: number }
>;

export function agentModelOptionsKey(providerId: string, workspaceId: string, projectId?: string | null) {
  return projectId
    ? `${providerId}::${workspaceId}::${projectId}`
    : `${providerId}::${workspaceId}`;
}

export function readAgentModelOptionsCache(): Record<string, AgentModelOptionsEntry> {
  try {
    const raw = window.localStorage.getItem(AGENT_MODEL_OPTIONS_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as AgentModelOptionsCache;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, entry]) => now - entry.cachedAt < AGENT_MODEL_OPTIONS_CACHE_TTL_MS)
        .map(([key, entry]) => [
          key,
          {
            loading: false,
            warmed: false,
            projectId: entry.projectId,
            runtimeSessionId: undefined,
            message: entry.message,
            modelOptions: entry.modelOptions ?? [],
            configOptions: entry.configOptions ?? [],
            state: entry.state ?? {},
          } satisfies AgentModelOptionsEntry,
        ]),
    );
  } catch {
    return {};
  }
}

export function writeAgentModelOptionsCache(
  nextEntries: Record<string, AgentModelOptionsEntry>,
) {
  try {
    const now = Date.now();
    const cache = Object.fromEntries(
      Object.entries(nextEntries)
        .filter(
          ([, entry]) =>
            !entry.loading &&
            ((entry.modelOptions?.length ?? 0) > 0 ||
              (entry.configOptions?.length ?? 0) > 0),
        )
        .map(([key, entry]) => {
          const { runtimeSessionId: _runtimeSessionId, ...cacheableEntry } = entry;
          return [key, { ...cacheableEntry, cachedAt: now }];
        }),
    );
    window.localStorage.setItem(
      AGENT_MODEL_OPTIONS_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // localStorage can be unavailable in private contexts; ignore cache failures.
  }
}
