import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptEventRow } from "./transcript-event-row.js";

test("transcript compaction rows render as collapsed muted system summaries", () => {
  const html = renderToStaticMarkup(
    createElement(TranscriptEventRow, {
      entry: {
        kind: "context_compaction",
        id: "compaction-1",
        summaryText: "This session is being continued from a previous conversation that ran out of context.",
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
    }),
  );

  assert.match(html, /上下文已压缩/);
  assert.match(html, /展开摘要/);
  assert.match(html, /bg-surface-sunken\/55/);
  assert.match(html, /border-border-ghost/);
  assert.doesNotMatch(html, /bg-amber-50/);
  assert.doesNotMatch(html, /border-amber-400/);
});

test("transcript resumed rows render as compact status rows", () => {
  const html = renderToStaticMarkup(
    createElement(TranscriptEventRow, {
      entry: {
        kind: "session_resumed",
        id: "resumed-1",
        restoreMethod: "session/resume",
        timestamp: "2026-06-18T13:55:25.194Z",
        updatedAt: "2026-06-18T13:55:25.194Z",
        replayCompleteness: "compacted",
      },
    }),
  );

  assert.match(html, /会话已恢复/);
  assert.match(html, /session\/resume/);
  assert.doesNotMatch(html, /bg-blue-50/);
  assert.doesNotMatch(html, /从先前会话恢复/);
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
