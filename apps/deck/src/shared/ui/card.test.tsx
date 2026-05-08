import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./card";

test("Card renders with surface background", () => {
  const html = renderToString(
    createElement(Card, null, "body"),
  );
  assert.match(html, /bg-surface/);
  assert.match(html, /rounded-lg/);
  assert.match(html, /body/);
});

test("CardHeader / CardTitle / CardContent compose", () => {
  const html = renderToString(
    createElement(
      Card,
      null,
      createElement(CardHeader, null,
        createElement(CardTitle, null, "Hello"),
      ),
      createElement(CardContent, null, "World"),
    ),
  );
  assert.match(html, /Hello/);
  assert.match(html, /World/);
});

test("Card uses ambient shadow (per Luminous Void)", () => {
  const html = renderToString(createElement(Card, null, "x"));
  assert.match(html, /shadow-ambient/);
});
