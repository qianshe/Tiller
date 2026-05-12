import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpdateNotice,
  formatExplicitUpdateOutput,
  formatStartupUpdateNotice,
  resolveUpdateOptions,
} from "./check.js";

test("resolveUpdateOptions defaults checks and preview hints on", () => {
  assert.deepEqual(resolveUpdateOptions({ env: {}, config: {} }), {
    checkOnStart: true,
    previewHint: true,
  });
});

test("resolveUpdateOptions lets env disable startup checks and preview hints", () => {
  assert.deepEqual(
    resolveUpdateOptions({
      env: { TILLER_UPDATE_CHECK: "0", TILLER_UPDATE_PREVIEW_HINT: "0" },
      config: { updates: { checkOnStart: true, previewHint: true } },
    }),
    { checkOnStart: false, previewHint: false },
  );
});

test("buildUpdateNotice prefers latest update", () => {
  assert.deepEqual(
    buildUpdateNotice(
      { current: "0.1.0", latest: "0.1.1", preview: "0.2.0-alpha.1" },
      { checkOnStart: true, previewHint: true },
    ),
    { kind: "latest-update", current: "0.1.0", latest: "0.1.1" },
  );
});

test("buildUpdateNotice returns preview hint when latest is not newer", () => {
  assert.deepEqual(
    buildUpdateNotice(
      { current: "0.1.1", latest: "0.1.1", preview: "0.2.0-alpha.1" },
      { checkOnStart: true, previewHint: true },
    ),
    { kind: "preview-hint", current: "0.1.1", preview: "0.2.0-alpha.1" },
  );
});

test("startup latest notice points to tiller update", () => {
  assert.deepEqual(
    formatStartupUpdateNotice({ kind: "latest-update", current: "0.1.0", latest: "0.1.1" }),
    ["[tiller] Update available: 0.1.0 -> 0.1.1", "[tiller] Run: tiller update"],
  );
});

test("explicit latest output says it will run npm latest", () => {
  assert.equal(
    formatExplicitUpdateOutput({ kind: "latest-update", current: "0.1.0", latest: "0.1.1" }),
    [
      "Tiller update available: 0.1.0 -> 0.1.1",
      "Running:",
      "  npm install -g @qianshe/tiller@latest",
    ].join("\n"),
  );
});

test("explicit preview output stays hint-only", () => {
  assert.equal(
    formatExplicitUpdateOutput({
      kind: "preview-hint",
      current: "0.1.1",
      preview: "0.2.0-alpha.1",
    }),
    [
      "Tiller is up to date on latest: 0.1.1",
      "Preview available: 0.2.0-alpha.1",
      "Try it with:",
      "  npm install -g @qianshe/tiller@preview",
    ].join("\n"),
  );
});
