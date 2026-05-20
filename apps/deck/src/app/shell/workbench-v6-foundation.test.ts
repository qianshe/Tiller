import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootSource = readFileSync(resolve(currentDir, "root.tsx"), "utf8");
const tokensCss = readFileSync(resolve(currentDir, "tokens.css"), "utf8");
const stylesCss = readFileSync(resolve(currentDir, "styles.css"), "utf8");

test("Workbench v6 Tailwind inline color aliases are registered", () => {
  assert.match(tokensCss, /@theme inline\s*{/);
  for (const token of [
    "--color-background: var(--background);",
    "--color-canvas: var(--canvas);",
    "--color-surface-sunken: var(--surface-sunken);",
    "--color-popover-glass: var(--popover-glass);",
    "--color-accent: var(--accent);",
    "--text-default--line-height: 1.45;",
  ]) {
    assert.match(tokensCss, new RegExp(token.replace(/[()]/g, "\\$&")));
  }
});

test("Workbench v6 shell utility classes are available", () => {
  for (const className of [
    ".h-ctl-xs",
    ".w-ctl-md",
    ".min-h-ctl-md",
    ".wb-pane",
    ".wb-pane-sunken",
    ".wb-pane-head",
    ".wb-focus-ring:focus-visible",
    ".mission-grid",
    ".mission-resizer",
  ]) {
    assert.match(stylesCss, new RegExp(className.replace(/[.]/g, "\\.")));
  }
});

test("Workbench v6 shell hides legacy top navigation outside landing", () => {
  assert.match(stylesCss, /\.shell\.v6-radial-shell > \.top-nav\s*\{[^}]*display:\s*none;/s);
  assert.match(stylesCss, /\.shell\.v6-radial-shell \.page-content\s*\{[^}]*padding:\s*0;[^}]*gap:\s*0;/s);
  assert.match(stylesCss, /\.shell\.view-dashboard/);
});

test("Workbench v6 shell does not mount the design-only tweaks panel", () => {
  assert.doesNotMatch(rootSource, /<TweaksPanel\b/);
  assert.doesNotMatch(rootSource, /deckDensity/);
  assert.doesNotMatch(rootSource, /deckViewport/);
  assert.doesNotMatch(rootSource, /dataset\.deckDensity/);
  assert.doesNotMatch(rootSource, /dataset\.deckViewport/);
});
