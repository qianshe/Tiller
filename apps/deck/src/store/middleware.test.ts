import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
} from "../features/preferences/facade.js";
import {
  createDeckStorePersistOptions,
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

test("deck persistence includes compact chat workbench state", () => {
  const options = createDeckStorePersistOptions();
  assert.ok(options.partialize);
  const partial = options.partialize({
    preferences: {} as never,
    daemonProfiles: [],
    selectedHelmKey: "local",
    openChatSessionIds: ["s1", "s2"],
    focusedChatWindowId: "session:s2",
    draftChatWindow: {
      id: "draft:project-1",
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: null,
    },
    sessionPlans: {
      s1: {
        entries: [
          { content: "复核 Markdown 渲染", priority: "medium", status: "completed" },
        ],
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    },
    dismissedCompletedSessionPlanKeys: {
      s1: "2026-06-02T00:00:00.000Z:复核 Markdown 渲染:completed",
    },
  } as never);

  assert.deepEqual(partial.openChatSessionIds, ["s1", "s2"]);
  assert.equal(partial.focusedChatWindowId, "session:s2");
  assert.deepEqual(partial.draftChatWindow, {
    id: "draft:project-1",
    projectId: "project-1",
    cwd: "D:/repo",
    agentId: null,
  });
  assert.deepEqual(partial.sessionPlans, {
    s1: {
      entries: [
        { content: "复核 Markdown 渲染", priority: "medium", status: "completed" },
      ],
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
  });
  assert.deepEqual(partial.dismissedCompletedSessionPlanKeys, {
    s1: "2026-06-02T00:00:00.000Z:复核 Markdown 渲染:completed",
  });
});
