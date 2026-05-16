import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
} from "../features/preferences/facade.js";
import {
  createDeckStorePersistStorage,
  DECK_STORE_STORAGE_KEY,
} from "./middleware.js";

function createMemoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

test("deck store persistence strips hidden prompt enhancer template fields at rest", () => {
  const rawStorage = createMemoryStorage();
  const storage = createDeckStorePersistStorage(rawStorage as Storage);
  const payload = JSON.stringify({
    state: {
      preferences: {
        promptEnhancer: {
          llm: {
            baseUrl: "http://localhost:8317/v1",
            systemPrompt: "CUSTOM SYSTEM PROMPT",
            instructionTemplate: "CUSTOM TEMPLATE",
          },
        },
      },
      daemonProfiles: [],
      selectedHelmKey: "",
    },
    version: 0,
  });

  storage.setItem(DECK_STORE_STORAGE_KEY, payload);

  const persisted = JSON.parse(
    rawStorage.getItem(DECK_STORE_STORAGE_KEY) ?? "{}",
  ) as {
    state?: {
      preferences?: { promptEnhancer?: { llm?: Record<string, unknown> } };
    };
  };
  const persistedLlm = persisted.state?.preferences?.promptEnhancer?.llm;
  assert.equal(persistedLlm?.baseUrl, "http://localhost:8317/v1");
  assert.equal(persistedLlm?.systemPrompt, undefined);
  assert.equal(persistedLlm?.instructionTemplate, undefined);

  const hydrated = JSON.parse(storage.getItem(DECK_STORE_STORAGE_KEY) ?? "{}") as {
    state?: {
      preferences?: { promptEnhancer?: { llm?: Record<string, unknown> } };
    };
  };
  const hydratedLlm = hydrated.state?.preferences?.promptEnhancer?.llm;
  assert.equal(hydratedLlm?.baseUrl, "http://localhost:8317/v1");
  assert.equal(hydratedLlm?.systemPrompt, DEFAULT_PROMPT_LLM_SYSTEM_PROMPT);
  assert.equal(
    hydratedLlm?.instructionTemplate,
    DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  );
});
