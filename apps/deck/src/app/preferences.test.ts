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
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Goal/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Success Criteria/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Verification/);
  assert.match(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /Minimal Change/);
  assert.doesNotMatch(DEFAULT_PROMPT_LLM_SYSTEM_PROMPT, /AGENTS/);
});
