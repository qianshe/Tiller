import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useDeckStore } from "../../../store";
import {
  buildUsageTooltipBody,
  ContextUsageIndicator,
  shouldAcceptUsageUpdate,
} from "./context-usage-indicator.js";

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

test("tooltip body shows remaining, usage, and cost when cost present", () => {
  const body: ReactElement = buildUsageTooltipBody({
    used: 6342,
    size: 258400,
    cost: { amount: 0.045, currency: "USD" },
  });
  const html = renderToStaticMarkup(body);
  // remainder = round((1 - 6342/258400) * 100) = 98
  // label 与值在不同 span,用 .*? 容忍标签边界
  assert.match(html, /剩余:.*?98%/u);
  assert.match(html, /用量:.*?6,342 \/ 258,400 t/u);
  assert.match(html, /费用:.*?\$0\.04/u);
});

test("tooltip body omits cost line when cost absent", () => {
  const body: ReactElement = buildUsageTooltipBody({
    used: 121426,
    size: 1000000,
    cost: null,
  });
  const html = renderToStaticMarkup(body);
  assert.match(html, /用量:.*?121,426 \/ 1,000,000 t/u);
  assert.doesNotMatch(html, /费用:/u);
});

test("indicator wraps the ring in a tooltip trigger when usage present", () => {
  useDeckStore.setState({
    sessionLiveStates: {
      "sess-c": { usage: { used: 6342, size: 258400 } } as any,
    },
  } as any);
  const html = renderToStaticMarkup(
    createElement(ContextUsageIndicator, { sessionId: "sess-c", isMobile: false }),
  );
  // Radix Tooltip trigger carries data-state; Content relies on Portal at runtime.
  assert.match(html, /data-state="closed"/u);
  assert.match(html, /cursor-help/u);
});

test("empty state still has no tooltip content section", () => {
  useDeckStore.setState({ sessionLiveStates: {} } as any);
  const html = renderToStaticMarkup(
    createElement(ContextUsageIndicator, { sessionId: null, isMobile: false }),
  );
  assert.doesNotMatch(html, /剩余:/u);
  assert.doesNotMatch(html, /用量:/u);
  assert.doesNotMatch(html, /data-state=/u);
});

test("high-water accepts first usage when prev is undefined", () => {
  assert.equal(shouldAcceptUsageUpdate(undefined, 1000), true);
});

test("high-water accepts increasing used", () => {
  assert.equal(shouldAcceptUsageUpdate(1000, 1200), true);
  assert.equal(shouldAcceptUsageUpdate(1000, 1000), true);
});

test("high-water rejects small drop as caliber noise (below threshold)", () => {
  // 2x 口径噪音:343200 -> 171600, drop = 0.5 < 0.6 阈值,丢弃
  assert.equal(shouldAcceptUsageUpdate(343200, 171600), false);
  // 30% 下降,丢弃
  assert.equal(shouldAcceptUsageUpdate(1000, 700), false);
});

test("high-water accepts large drop as compaction (at/above threshold)", () => {
  // 60% drop 恰好阈值,接受
  assert.equal(shouldAcceptUsageUpdate(1000, 400), true);
  // 80% drop,典型 compaction,接受
  assert.equal(shouldAcceptUsageUpdate(343000, 68000), true);
});
