import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionDisplayPanel } from "./display-panel.js";

test("mission overview renders active ACP runtimes below project cards", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "overview", title: "概览" }],
      selectedPage: { id: "overview", title: "概览" },
      selectedDiffFilePath: null,
      diffs: [],
      diffCount: 0,
      logCount: 0,
      overviewItems: ["Project · Tiller"],
      runtimeOverviewItems: [
        {
          id: "session:session-1",
          label: "Codex",
          meta: "会话 · main · 空闲",
          status: "会话",
          runtimeSessionId: "runtime-1",
          model: "gpt-5.5",
        },
      ],
      noDiffSummary: "暂无 diff",
      logbookContent: null,
      collapsedDiffDirectories: new Set<string>(),
      onAddPage: () => undefined,
      onSelectPage: () => undefined,
      onDragStart: () => undefined,
      onDrop: () => undefined,
      onOpenDiffDetail: () => undefined,
      onRenamePage: () => undefined,
      onMovePage: () => undefined,
      onDeletePage: () => undefined,
      onToggleDiffDirectory: () => undefined,
    }),
  );

  assert.match(html, /ACP Runtime/);
  assert.match(html, /runtime-1/);
  assert.match(html, /Codex/);
  assert.match(html, /会话 · main · 空闲/);
});
