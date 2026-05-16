import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
} from "../features/preferences/facade";
import { persistAdapter } from "./persist";
import type { DeckStore } from "./index";

export const DECK_STORE_STORAGE_KEY = "tiller.deck.store";

type PersistedDeckStore = Pick<
  DeckStore,
  "preferences" | "daemonProfiles" | "selectedHelmKey"
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
    }),
  };
}

export function createDeckStorePersistStorage(storage: Storage) {
  const adapter = persistAdapter(storage);
  return {
    getItem(name: string) {
      return sanitizeDeckStorePayload(adapter.getItem(name), "hydrate");
    },
    setItem(name: string, value: string) {
      adapter.setItem(name, sanitizeDeckStorePayload(value, "store") ?? value);
    },
    removeItem(name: string) {
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
