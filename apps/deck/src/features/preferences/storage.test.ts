import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE } from "../prompt-enhancer/facade.js";
import {
  DEFAULT_DECK_PREFERENCES,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
  DECK_PREFERENCES_STORAGE_KEY,
  isDeckTheme,
  readDeckPreferences,
} from "./storage.js";

const ENGINE_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE =
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE;

function withStoredPreferences(raw: string, callback: (store: Map<string, string>) => void) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const store = new Map([[DECK_PREFERENCES_STORAGE_KEY, raw]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    },
  });
  try {
    callback(store);
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}

test("default technical panel preferences keep approval worktree visible", () => {
  assert.equal(
    DEFAULT_DECK_PREFERENCES.technicalPanels.showPermissionWorktree,
    true,
  );
  assert.equal(DEFAULT_DECK_PREFERENCES.technicalPanels.showMissionThinking, true);
});

test("readDeckPreferences preserves stored technical panel preferences", () => {
  withStoredPreferences(
    JSON.stringify({
      technicalPanels: {
        diffDefaultOpen: true,
        showSessionRuntimeMeta: false,
        showPermissionWorktree: false,
        showMissionThinking: false,
        showConnectionDebug: true,
      },
    }),
    () => {
      const preferences = readDeckPreferences();

      assert.deepEqual(preferences.technicalPanels, {
        diffDefaultOpen: true,
        showSessionRuntimeMeta: false,
        showPermissionWorktree: false,
        showMissionThinking: false,
        showConnectionDebug: true,
      });
    },
  );
});

test("readDeckPreferences preserves the Tiller theme", () => {
  assert.equal(isDeckTheme("tiller"), true);

  withStoredPreferences(JSON.stringify({ theme: "tiller" }), () => {
    const preferences = readDeckPreferences();

    assert.equal(preferences.theme, "tiller");
  });
});

test("default preferences use the prompt enhancer engine template", () => {
  assert.equal(
    DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.instructionTemplate,
    ENGINE_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  );
});

test("default prompt enhancer system prompt encodes self-contained goal and razor principles", () => {
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /User draft is the source of truth/,
  );
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Razor rule/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /fewest assumptions/);
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /If the draft is already actionable/,
  );
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Use the user's language/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Preserve the task mode/);
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /Do not mention private reference/,
  );
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /Do not pretend you inspected the repository/,
  );
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /clarifying options or questions/,
  );
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /Do not add constraints unless/,
  );
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /Do not turn planning or discussion into implementation/,
  );
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Internal editing workflow/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Keep/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Drop/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Clarify/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Inspect/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Propose/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Verify/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Defer/);
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /directly usable as the user's next message/,
  );
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not prefix/);
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /Do not output guessed file paths/,
  );
  assert.match(
    DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
    /For new product ideas, label inferred features as options/,
  );
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /not fixed requirements/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Goal/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Success Criteria/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Verification/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Minimal Change/);
  assert.doesNotMatch(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /AGENTS/);
});

test("readDeckPreferences ignores stored prompt enhancer system prompt and template overrides", () => {
  withStoredPreferences(
    JSON.stringify({
      promptEnhancer: {
        llm: {
          systemPrompt: "CUSTOM SYSTEM PROMPT",
          instructionTemplate: "CUSTOM TEMPLATE",
        },
      },
    }),
    (store) => {
      const preferences = readDeckPreferences();

      assert.equal(
        preferences.promptEnhancer.llm.systemPrompt,
        DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.systemPrompt,
      );
      assert.equal(
        preferences.promptEnhancer.llm.instructionTemplate,
        DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.instructionTemplate,
      );

      const persisted = JSON.parse(
        store.get(DECK_PREFERENCES_STORAGE_KEY) ?? "{}",
      ) as Record<string, unknown>;
      const llm = (persisted.promptEnhancer as { llm?: Record<string, unknown> })
        .llm;
      assert.equal(llm?.systemPrompt, undefined);
      assert.equal(llm?.instructionTemplate, undefined);
    },
  );
});
