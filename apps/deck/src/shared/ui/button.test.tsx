import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { Button } from "./button";

test("Button renders children", () => {
  const html = renderToString(createElement(Button, null, "Click me"));
  assert.match(html, /Click me/);
});

test("Button default variant uses flat primary classes", () => {
  const html = renderToString(createElement(Button, null, "Confirm"));

  assert.match(html, /bg-primary/);
  assert.match(html, /text-on-primary/);
  assert.match(html, /hover:bg-primary-strong/);
  assert.doesNotMatch(html, /from-primary/);
  assert.doesNotMatch(html, /to-primary-strong/);
});

test("Button outline variant uses ring-based boundary", () => {
  const html = renderToString(createElement(Button, { variant: "outline" }, "Cancel"));

  assert.match(html, /ring-border-ghost\/40/);
  assert.match(html, /bg-transparent/);
  assert.doesNotMatch(html, /border-border-ghost/);
});

test("Button ghost variant has no background by default", () => {
  const html = renderToString(createElement(Button, { variant: "ghost" }, "Ghost"));
  assert.doesNotMatch(html, /(?:^|\\s)bg-primary(?:\\s|$)/);
});

test("Button forwards disabled attribute", () => {
  const html = renderToString(createElement(Button, { disabled: true }, "Disabled"));
  assert.match(html, /disabled=""/);
});

test("Button uses Workbench typography tokens", () => {
  const defaultHtml = renderToString(createElement(Button, null, "Default"));
  const smallHtml = renderToString(createElement(Button, { size: "sm" }, "Small"));

  assert.match(defaultHtml, /text-section/);
  assert.match(smallHtml, /text-meta/);
  assert.doesNotMatch(`${defaultHtml} ${smallHtml}`, /text-\[13px\]/);
  assert.doesNotMatch(`${defaultHtml} ${smallHtml}`, /text-xs/);
  assert.doesNotMatch(`${defaultHtml} ${smallHtml}`, /text-sm/);
});