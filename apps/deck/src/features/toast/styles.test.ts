import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const stylesSource = readFileSync(resolve(currentDir, "styles.css"), "utf8");

test("Voyage uses the dark toast treatment", () => {
  assert.match(
    stylesSource,
    /\[data-theme="dark"\] \.toast-item,\s*\[data-theme="voyage"\] \.toast-item\s*{/,
  );
  assert.match(
    stylesSource,
    /\[data-theme="dark"\] \.toast-close,\s*\[data-theme="voyage"\] \.toast-close\s*{/,
  );
  assert.match(
    stylesSource,
    /\[data-theme="dark"\] \.toast-close:hover,\s*\[data-theme="dark"\] \.toast-close:focus-visible,\s*\[data-theme="voyage"\] \.toast-close:hover,\s*\[data-theme="voyage"\] \.toast-close:focus-visible\s*{/,
  );
});
