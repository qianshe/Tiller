import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegacyEvidencePanel } from "./legacy-evidence-panel.js";

test("legacy evidence panel starts collapsed and renders only the requested source page", () => {
  const html = renderToStaticMarkup(
    createElement(LegacyEvidencePanel, {
      state: {
        availability: {
          sessionId: "session-1",
          available: true,
          counts: { message: 2, tool_call: 1, output: 0 },
        },
        pages: {
          message: {
            sessionId: "session-1",
            source: "message",
            items: [{ source: "message", sourcePosition: 1, entity: { id: "legacy-message" } }],
            issues: [],
            hasMore: false,
          },
        },
        loading: {},
      },
      onLoad: () => undefined,
    }),
  );

  assert.match(html, /旧记录证据 · 3 项/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /legacy-message/);
  assert.doesNotMatch(html, /tool_call.*legacy-message/);
});
