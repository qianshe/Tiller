import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { Button } from "./button";

test("Button renders children", () => {
  const html = renderToString(createElement(Button, null, "Click me"));
  assert.match(html, /Click me/);
});

test("Button default variant uses gradient CTA classes", () => {
  const html = renderToString(createElement(Button, null, "Confirm"));
  assert.match(html, /from-primary/);
  assert.match(html, /to-primary-strong/);
  assert.match(html, /text-on-primary/);
});

test("Button outline variant has border-ghost utility", () => {
  const html = renderToString(createElement(Button, { variant: "outline" }, "Cancel"));
  assert.match(html, /border-border-ghost/);
});

test("Button ghost variant has no background by default", () => {
  const html = renderToString(createElement(Button, { variant: "ghost" }, "Ghost"));
  assert.doesNotMatch(html, /(?:^|\\s)bg-primary(?:\\s|$)/);
});

test("Button forwards disabled attribute", () => {
  const html = renderToString(createElement(Button, { disabled: true }, "Disabled"));
  assert.match(html, /disabled=""/);
});

