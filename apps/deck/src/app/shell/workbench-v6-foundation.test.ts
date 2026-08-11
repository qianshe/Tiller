import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootSource = readFileSync(resolve(currentDir, "root.tsx"), "utf8");
const tokensCss = readFileSync(resolve(currentDir, "tokens.css"), "utf8");
const brandCss = readFileSync(resolve(currentDir, "tokens/brand.css"), "utf8");
const semanticCss = readFileSync(resolve(currentDir, "tokens/semantic.css"), "utf8");
const lightCss = readFileSync(resolve(currentDir, "tokens/themes/light.css"), "utf8");
const darkCss = readFileSync(resolve(currentDir, "tokens/themes/dark.css"), "utf8");
const stylesCss = readFileSync(resolve(currentDir, "styles.css"), "utf8");
const tokensBundle = [tokensCss, brandCss, semanticCss, lightCss, darkCss].join("\n");

test("Workbench v6 Tailwind inline color aliases are registered", () => {
  assert.match(semanticCss, /@theme inline\s*{/);
  for (const token of [
    "--color-background: var(--background);",
    "--color-canvas: var(--canvas);",
    "--color-surface-sunken: var(--surface-sunken);",
    "--color-popover-glass: var(--popover-glass);",
    "--color-accent: var(--accent);",
    "--text-default--line-height: 1.45;",
  ]) {
    assert.match(tokensBundle, new RegExp(token.replace(/[()]/g, "\\$&")));
  }
});

test("Voyage activates Tailwind dark utilities", () => {
  assert.match(
    tokensCss,
    /@custom-variant dark \(&:where\(\[data-theme="dark"\] \*, \[data-theme="voyage"\] \*\)\);/,
  );
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

test("Workbench v6 shell no longer ships legacy top navigation", () => {
  assert.doesNotMatch(stylesCss, /\.top-nav/);
  assert.doesNotMatch(stylesCss, /\.admiral-/);
  assert.match(stylesCss, /\.shell\.v6-radial-shell \.page-content\s*\{[^}]*padding:\s*0;[^}]*gap:\s*0;/s);
  assert.match(stylesCss, /\.shell\.v6-radial-shell\s*\{[^}]*width:\s*100vw;/s);
  assert.match(stylesCss, /\.shell\.v6-radial-shell\s*\{[^}]*max-width:\s*100%;/s);
});

test("Dashboard keeps the shell viewport fixed while its content region scrolls", () => {
  assert.match(
    stylesCss,
    /\.shell\.view-dashboard\.v6-radial-shell \.page-content\s*\{[^}]*overflow:\s*hidden;/s,
  );
});

test("Dashboard quick create launches the prompt instead of staging the Mission composer", () => {
  const handlerSource = rootSource
    .split("function openNewTaskFromDashboard")[1]
    ?.split("const layoutContext")[0] ?? "";
  assert.match(handlerSource, /launchDashboardTask/);
  assert.match(handlerSource, /finalizeDashboardTaskLaunch/);
  assert.doesNotMatch(handlerSource, /session\/rename/);
  assert.doesNotMatch(handlerSource, /setDraftChatWindow|setPrompt\(/);
});

test("Workbench v6 shell does not mount the design-only tweaks panel", () => {
  assert.doesNotMatch(rootSource, /<TweaksPanel\b/);
  assert.doesNotMatch(rootSource, /deckDensity/);
  assert.doesNotMatch(rootSource, /deckViewport/);
  assert.doesNotMatch(rootSource, /dataset\.deckDensity/);
  assert.doesNotMatch(rootSource, /dataset\.deckViewport/);
});
