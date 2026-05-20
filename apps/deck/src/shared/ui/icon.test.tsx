import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentIcon, Icon, StatusDot } from "./icon";

test("Icon renders registered SVG icons and hides them from assistive tech", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "send", title: "Send prompt" }));

  assert.match(html, /<svg/);
  assert.match(html, /aria-label="Send prompt"/);
  assert.match(html, /<title>Send prompt<\/title>/);
});

test("Icon renders a deterministic fallback for unknown names", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "missing" as never }));

  assert.match(html, /\?missing/);
  assert.match(html, /text-destructive/);
});

test("StatusDot maps semantic tones to token-backed classes", () => {
  const html = renderToStaticMarkup(createElement(StatusDot, { tone: "warning", pulse: true }));

  assert.match(html, /bg-warning/);
  assert.match(html, /wb-pulse/);
});

test("AgentIcon renders original provider image assets and fallback initials", () => {
  const known = renderToStaticMarkup(createElement(AgentIcon, { name: "codex" }));
  const fallback = renderToStaticMarkup(createElement(AgentIcon, { name: "local-agent" }));

  assert.match(known, /<img/);
  assert.match(known, /provider-icons\/codex\.svg/);
  assert.doesNotMatch(known, /<svg/);
  assert.match(fallback, /LA/);
});
