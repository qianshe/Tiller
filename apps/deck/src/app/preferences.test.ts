import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE as ENGINE_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE } from "../features/prompt-enhancer/enhancer.js";
import { DEFAULT_DECK_PREFERENCES, DEFAULT_PROMPT_LLM_SYSTEM_PROMPT } from "./preferences.js";

test("default preferences use the prompt enhancer engine template", () => {
  assert.equal(DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.instructionTemplate, ENGINE_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE);
});

test("default prompt enhancer system prompt encodes self-contained goal and razor principles", () => {
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /User draft is the source of truth/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Razor rule/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /fewest assumptions/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /If the draft is already actionable/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Use the user's language/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Preserve the task mode/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not mention private reference/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not pretend you inspected the repository/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /clarifying options or questions/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not add constraints unless/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not turn planning or discussion into implementation/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Internal editing workflow/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Keep/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Drop/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Clarify/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Inspect/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Propose/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Verify/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Defer/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /directly usable as the user's next message/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not prefix/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Do not output guessed file paths/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /For new product ideas, label inferred features as options/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /not fixed requirements/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Goal/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Success Criteria/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Verification/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Minimal Change/);
  assert.doesNotMatch(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /AGENTS/);
});
