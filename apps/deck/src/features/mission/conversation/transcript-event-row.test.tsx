import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptEventRow } from "./transcript-event-row.js";

const transcriptEventRowSource = readFileSync(
  new URL("./transcript-event-row.tsx", import.meta.url),
  "utf8",
);

test("transcript compaction rows render as collapsed muted system summaries", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderToStaticMarkup(
    createElement(TranscriptEventRow, {
      entry: {
        kind: "context_compaction",
        id: "compaction-1",
        phase: "completed",
        source: "provider",
        summaryText,
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
    }),
  );

  assert.match(html, /上下文已压缩/);
  assert.match(html, /aria-label="展开摘要"/);
  assert.match(html, /bg-surface-sunken\/55/);
  assert.match(html, /border-border-ghost/);
  assert.match(html, /min-w-0 w-full rounded-\[8px\]/);
  assert.match(html, /grid-cols-\[0\.375rem_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(html, /grid-cols-\[0\.375rem_minmax\(0,1fr\)_0\.375rem\]/);
  assert.match(html, /justify-center/);
  assert.match(html, /absolute right-0 top-1\/2/);
  assert.doesNotMatch(html, />展开摘要</);
  assert.doesNotMatch(html, /早期对话已压缩，后续回复将基于摘要继续/);
  assert.doesNotMatch(html, new RegExp(summaryText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /bg-amber-50/);
  assert.doesNotMatch(html, /border-amber-400/);
});

test("transcript compaction rows render pending state directly from timeline entries", () => {
  const html = renderToStaticMarkup(
    createElement(TranscriptEventRow, {
      entry: {
        kind: "context_compaction",
        id: "compaction-pending",
        phase: "started",
        source: "provider",
        timestamp: "2026-06-18T13:55:25.192Z",
        updatedAt: "2026-06-18T13:55:25.192Z",
        replayCompleteness: "compacted",
      },
    }),
  );

  assert.match(html, /正在压缩上下文/);
  assert.match(html, /完成后会基于压缩后的上下文继续回复/);
});

test("transcript history gap rows keep warning semantics without bright cards", () => {
  const html = renderToStaticMarkup(
    createElement(TranscriptEventRow, {
      entry: {
        kind: "history_gap",
        id: "gap-1",
        timestamp: "2026-06-18T13:55:25.195Z",
        updatedAt: "2026-06-18T13:55:25.195Z",
        message: "Earlier transcript is unavailable; only post-compaction history could be restored.",
      },
    }),
  );

  assert.match(html, /历史记录缺失/);
  assert.match(html, /Earlier transcript is unavailable/);
  assert.doesNotMatch(html, /bg-red-50/);
  assert.doesNotMatch(html, /border-red-400/);
});

test("transcript compaction rows can hide summary details for providers that only expose the boundary marker", () => {
  const html = renderToStaticMarkup(
    createElement(TranscriptEventRow, {
      entry: {
        kind: "context_compaction",
        id: "compaction-hidden",
        phase: "completed",
        source: "provider",
        summaryText: "This session is being continued from a previous conversation that ran out of context.",
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
        detailsVisibility: "hidden",
      },
    }),
  );

  assert.match(html, /上下文已压缩/);
  assert.doesNotMatch(html, /展开摘要/);
  assert.doesNotMatch(html, /收起摘要/);
});

test("expanded compaction summaries expose bottom-right collapse and copy actions", () => {
  assert.match(transcriptEventRowSource, /compaction-summary-copy/);
  assert.match(transcriptEventRowSource, /compaction-summary-collapse/);
  assert.match(transcriptEventRowSource, /compaction-summary-actions absolute bottom-0 right-0/);
  assert.match(transcriptEventRowSource, /onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(transcriptEventRowSource, /writeClipboardText\(\s*summaryText/);
  assert.match(transcriptEventRowSource, /aria-live="polite"/);
});
