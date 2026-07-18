import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useDeckStore } from "../../../store";
import { ContextUsageIndicator } from "./context-usage-indicator.js";

test("empty state renders empty ring and dash marker without tooltip trigger role", () => {
  useDeckStore.setState({ sessionLiveStates: {} } as any);
  const html = renderToStaticMarkup(
    createElement(ContextUsageIndicator, { sessionId: null, isMobile: false }),
  );
  assert.match(html, /–/u);
  assert.doesNotMatch(html, /role="button"/u);
});