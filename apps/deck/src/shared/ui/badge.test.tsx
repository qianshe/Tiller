import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { Badge } from "./badge";

test("Badge renders children with rounded-full", () => {
  const html = renderToString(createElement(Badge, null, "Live"));
  assert.match(html, /rounded-full/);
  assert.match(html, /Live/);
});

test("Badge default variant uses primary-soft", () => {
  const html = renderToString(createElement(Badge, null, "x"));
  assert.match(html, /bg-primary-soft/);
});

test("Badge success variant uses success-container", () => {
  const html = renderToString(
    createElement(Badge, { variant: "success" }, "Online"),
  );
  assert.match(html, /bg-success-container/);
  assert.match(html, /text-on-success-container/);
});

test("Badge has no border", () => {
  const html = renderToString(createElement(Badge, null, "x"));
  assert.doesNotMatch(html, /\bborder\b/);
});
