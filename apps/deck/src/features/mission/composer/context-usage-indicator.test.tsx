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

test("ring arc offset reflects used/size ratio", () => {
  useDeckStore.setState({
    sessionLiveStates: {
      "sess-a": { usage: { used: 127656, size: 200000 } } as any,
    },
  } as any);
  const html = renderToStaticMarkup(
    createElement(ContextUsageIndicator, { sessionId: "sess-a", isMobile: false }),
  );
  // ratio = 0.638, offset ≈ 37.699 * (1 - 0.638) ≈ 13.637
  assert.match(html, /stroke-dashoffset="13\.6[0-9]+"/u);
  assert.match(html, /aria-label="上下文已用 64%"/u);
});

test("ring rotates so arc starts at 12-o'clock", () => {
  useDeckStore.setState({
    sessionLiveStates: {
      "sess-b": { usage: { used: 25000, size: 100000 } } as any,
    },
  } as any);
  const html = renderToStaticMarkup(
    createElement(ContextUsageIndicator, { sessionId: "sess-b", isMobile: false }),
  );
  assert.match(html, /<svg[^>]*-rotate-90/u);
});
