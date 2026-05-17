import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionStatusBar } from "./mission-status-bar.js";

test("MissionStatusBar renders nothing when no signal is active", () => {
  const html = renderToStaticMarkup(
    createElement(MissionStatusBar, {
      modelLoading: false,
      promptEnhancing: false,
    }),
  );
  assert.equal(html, "");
});

test("MissionStatusBar shows model loading label only", () => {
  const html = renderToStaticMarkup(
    createElement(MissionStatusBar, {
      modelLoading: true,
      promptEnhancing: false,
    }),
  );
  assert.match(html, /模型加载中/);
  assert.doesNotMatch(html, /增强中/);
  assert.doesNotMatch(html, /·/);
});

test("MissionStatusBar shows enhancing label only", () => {
  const html = renderToStaticMarkup(
    createElement(MissionStatusBar, {
      modelLoading: false,
      promptEnhancing: true,
    }),
  );
  assert.match(html, /增强中/);
  assert.doesNotMatch(html, /模型加载中/);
  assert.doesNotMatch(html, /·/);
});

test("MissionStatusBar shows both labels joined by middle dot in fixed order", () => {
  const html = renderToStaticMarkup(
    createElement(MissionStatusBar, {
      modelLoading: true,
      promptEnhancing: true,
    }),
  );
  assert.match(html, /模型加载中/);
  assert.match(html, /增强中/);
  assert.match(html, /·/);
  const modelIndex = html.indexOf("模型加载中");
  const dotIndex = html.indexOf("·");
  const enhancingIndex = html.indexOf("增强中");
  assert.ok(modelIndex >= 0 && dotIndex > modelIndex && enhancingIndex > dotIndex,
    `expected order 模型加载中 -> · -> 增强中, got indices ${modelIndex}/${dotIndex}/${enhancingIndex}`);
});

test("MissionStatusBar uses compact status typography", () => {
  const html = renderToStaticMarkup(
    createElement(MissionStatusBar, {
      modelLoading: true,
      promptEnhancing: false,
    }),
  );
  assert.match(html, /mission-status-bar[^\"]*text-\[10px\][^\"]*leading-none/);
  assert.match(html, /mission-status-bar[^\"]*justify-self-center/);
  assert.match(html, /mission-status-bar[^\"]*justify-center/);
  assert.match(html, /mission-status-bar[^\"]*px-2/);
});

test("MissionStatusBar exposes status role and polite live region", () => {
  const html = renderToStaticMarkup(
    createElement(MissionStatusBar, {
      modelLoading: true,
      promptEnhancing: false,
    }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
});
