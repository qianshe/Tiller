import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TweaksPanel } from "./tweaks-panel";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "tweaks-panel.tsx"), "utf8");

const baseProps = {
  theme: "dark" as const,
  onThemeChange: () => undefined,
  density: "default" as const,
  onDensityChange: () => undefined,
  viewport: "auto" as const,
  onViewportChange: () => undefined,
};

test("TweaksPanel is disabled by default", () => {
  const html = renderToStaticMarkup(createElement(TweaksPanel, baseProps));

  assert.equal(html, "");
});

test("TweaksPanel renders prop-driven theme, density and viewport controls when enabled", () => {
  const html = renderToStaticMarkup(createElement(TweaksPanel, { ...baseProps, enabled: true, initialOpen: true }));

  assert.match(html, /主题/);
  assert.match(html, /密度/);
  assert.match(html, /视口/);
  assert.match(html, /dark/);
  assert.match(html, /24px/);
  assert.match(html, /auto/);
});

test("TweaksPanel does not mutate body dataset directly", () => {
  assert.doesNotMatch(source, /document\.body\.dataset/);
  assert.doesNotMatch(source, /\.\.\/data\/mock/);
  assert.doesNotMatch(source, /docs\/redesign\/v6/);
});
