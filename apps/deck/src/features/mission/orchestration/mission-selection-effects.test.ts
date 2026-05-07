import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceText = readFileSync(
  new URL("./mission-selection-effects.ts", import.meta.url),
  "utf8",
);
const composerSourceText = readFileSync(
  new URL("../ui/composer-config-controls.tsx", import.meta.url),
  "utf8",
);
const composerShellSourceText = readFileSync(
  new URL("../ui/composer.tsx", import.meta.url),
  "utf8",
);

test("mission selection effects reads setAgentModelOptions from source context", () => {
  const destructuredSource = sourceText.match(
    /const\s*\{([\s\S]*?)\}\s*=\s*source;/,
  )?.[1];

  assert.ok(destructuredSource, "source destructuring block should exist");
  assert.match(destructuredSource, /\bsetAgentModelOptions\b/);
});

test("mission selection effects preserves available model options while probing", () => {
  assert.match(
    sourceText,
    /modelOptions:\s*cached\?\.modelOptions\s*\?\?\s*\[\]/,
  );
  assert.match(
    sourceText,
    /configOptions:\s*cached\?\.configOptions\s*\?\?\s*\[\]/,
  );
  assert.match(
    sourceText,
    /state:\s*cached\?\.state\s*\?\?\s*\{\}/,
  );
});

test("mission model picker surfaces loading state without hiding cached options", () => {
  assert.match(composerSourceText, /modelLoading:\s*boolean/);
  assert.match(composerSourceText, /mission-config-loading-badge/);
  assert.match(composerSourceText, /正在加载模型列表/);
  assert.match(composerShellSourceText, /modelLoading=\{draftModelLoading\}/);
});
