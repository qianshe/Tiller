import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatRenderError } from "./error-boundary.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const errorBoundarySource = readFileSync(resolve(currentDir, "error-boundary.tsx"), "utf8");
const shellStylesSource = readFileSync(resolve(currentDir, "styles.css"), "utf8");

test("formatRenderError returns concrete render error messages", () => {
  assert.equal(formatRenderError(new Error("Git diff render failed")), "Git diff render failed");
  assert.equal(formatRenderError("plain failure"), "plain failure");
  assert.equal(formatRenderError(null), "未知渲染错误");
});

test("AppErrorBoundary uses shared Button and Tailwind-only fallback classes", () => {
  assert.match(errorBoundarySource, /from "@\/shared\/ui"/);
  assert.match(errorBoundarySource, /<Button\b/);
  assert.doesNotMatch(
    errorBoundarySource,
    /\b(shell|app-error-boundary|panel|app-error-card|eyebrow|muted|compact|primary)\b/,
  );
});

test("shell styles no longer define ErrorBoundary fallback selectors", () => {
  assert.doesNotMatch(shellStylesSource, /\.app-error-boundary|\.app-error-card/);
});
