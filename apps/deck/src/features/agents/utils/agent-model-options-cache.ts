import type {
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";

const AGENT_MODEL_OPTIONS_CACHE_KEY = "tiller.agent-model-options-cache";
const AGENT_MODEL_OPTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type AgentModelOptionsEntry = {
  loading?: boolean;
  message?: string;
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

export function agentModelOptionsKey(providerId: string, workspaceId: string) {
  return `${providerId}::${workspaceId}`;
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
        .map(([key, entry]) => [key, { ...entry, cachedAt: now }]),
    );
    window.localStorage.setItem(
      AGENT_MODEL_OPTIONS_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // localStorage can be unavailable in private contexts; ignore cache failures.
  }
}
