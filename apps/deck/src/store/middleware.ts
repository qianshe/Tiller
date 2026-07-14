import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
} from "../features/preferences/facade";
import { persistAdapter } from "./persist";
import type { DeckStore } from "./index";

export const DECK_STORE_STORAGE_KEY = "tiller.deck.store";
const DEFAULT_PERSIST_WRITE_DELAY_MS = 100;

let transientPersistenceDepth = 0;

export function withDeckStorePersistenceSuppressed<T>(operation: () => T): T {
  transientPersistenceDepth += 1;
  try {
    return operation();
  } finally {
    transientPersistenceDepth -= 1;
  }
}

type PersistedDeckStore = Pick<
  DeckStore,
  | "preferences"
  | "daemonProfiles"
  | "selectedHelmKey"
  | "openChatSessionIds"
  | "focusedChatWindowId"
  | "draftChatWindow"
  | "dismissedCompletedSessionPlanKeys"
>;

export function createDeckStorePersistOptions(): PersistOptions<
  DeckStore,
  PersistedDeckStore
> {
  return {
    name: DECK_STORE_STORAGE_KEY,
    storage: createJSONStorage(() =>
      createDeckStorePersistStorage(window.localStorage),
    ),
    partialize: (state) => ({
      preferences: state.preferences,
      daemonProfiles: state.daemonProfiles,
      selectedHelmKey: state.selectedHelmKey,
      openChatSessionIds: state.openChatSessionIds,
      focusedChatWindowId: state.focusedChatWindowId,
      draftChatWindow: state.draftChatWindow,
      dismissedCompletedSessionPlanKeys: state.dismissedCompletedSessionPlanKeys,
    }),
    merge: (persistedState, currentState) => {
      const persisted = persistedState as PersistedDeckStore | undefined;
      if (!persisted) return currentState;
      const { sessionPlans: _legacySessionPlans, ...persistedValues } = persisted as
        PersistedDeckStore & { sessionPlans?: unknown };
      return {
        ...currentState,
        ...persistedValues,
        openChatSessionIds: Array.isArray(persisted.openChatSessionIds)
          ? persisted.openChatSessionIds.filter((id): id is string => typeof id === "string")
          : currentState.openChatSessionIds,
        focusedChatWindowId:
          typeof persisted.focusedChatWindowId === "string" || persisted.focusedChatWindowId === null
            ? persisted.focusedChatWindowId
            : currentState.focusedChatWindowId,
        draftChatWindow: isDraftChatWindow(persisted.draftChatWindow)
          ? persisted.draftChatWindow
          : currentState.draftChatWindow,
        dismissedCompletedSessionPlanKeys: isStringMap(
          persisted.dismissedCompletedSessionPlanKeys,
        )
          ? persisted.dismissedCompletedSessionPlanKeys
          : currentState.dismissedCompletedSessionPlanKeys,
        preferences: persisted.preferences
          ? {
              ...currentState.preferences,
              ...persisted.preferences,
              technicalPanels: {
                ...currentState.preferences.technicalPanels,
                ...(persisted.preferences.technicalPanels ?? {}),
              },
              promptEnhancer: {
                ...currentState.preferences.promptEnhancer,
                ...(persisted.preferences.promptEnhancer ?? {}),
                llm: {
                  ...currentState.preferences.promptEnhancer.llm,
                  ...(persisted.preferences.promptEnhancer?.llm ?? {}),
                },
              },
            }
          : currentState.preferences,
      };
    },
  };
}

export function createDeckStorePersistStorage(
  storage: Storage,
  options: { writeDelayMs?: number } = {},
) {
  const adapter = persistAdapter(storage);
  const writeDelayMs = options.writeDelayMs ?? DEFAULT_PERSIST_WRITE_DELAY_MS;
  const lastWrittenByKey = new Map<string, string>();
  let pending: { name: string; value: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const next = pending;
    pending = undefined;
    if (!next || lastWrittenByKey.get(next.name) === next.value) {
      return;
    }
    adapter.setItem(next.name, next.value);
    lastWrittenByKey.set(next.name, next.value);
  }

  return {
    getItem(name: string) {
      return sanitizeDeckStorePayload(adapter.getItem(name), "hydrate");
    },
    setItem(name: string, value: string) {
      if (transientPersistenceDepth > 0) {
        return;
      }
      const sanitized = sanitizeDeckStorePayload(value, "store") ?? value;
      if (lastWrittenByKey.get(name) === sanitized || pending?.value === sanitized) {
        return;
      }
      pending = { name, value: sanitized };
      if (writeDelayMs <= 0) {
        flush();
        return;
      }
      if (!timer) {
        timer = setTimeout(flush, writeDelayMs);
      }
    },
    removeItem(name: string) {
      if (pending?.name === name) {
        pending = undefined;
      }
      lastWrittenByKey.delete(name);
      adapter.removeItem(name);
    },
  };
}

function sanitizeDeckStorePayload(value: string | null, mode: "hydrate" | "store") {
  if (!value) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    const llm = readPersistedPromptEnhancerLlm(parsed);
    if (!llm) {
      return value;
    }

    if (mode === "hydrate") {
      llm.systemPrompt = DEFAULT_PROMPT_LLM_SYSTEM_PROMPT;
      llm.instructionTemplate = DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE;
    } else {
      delete llm.systemPrompt;
      delete llm.instructionTemplate;
    }
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function readPersistedPromptEnhancerLlm(value: unknown) {
  if (!isRecord(value) || !isRecord(value.state)) {
    return null;
  }
  const { preferences } = value.state;
  if (!isRecord(preferences) || !isRecord(preferences.promptEnhancer)) {
    return null;
  }
  const { llm } = preferences.promptEnhancer;
  return isRecord(llm) ? llm : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDraftChatWindow(value: unknown): value is PersistedDeckStore["draftChatWindow"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    (typeof value.cwd === "string" || value.cwd === null) &&
    (typeof value.agentId === "string" || value.agentId === null)
  );
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
