import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionDisplayPanel } from "./display-panel.js";

test("mission overview renders active ACP connections below project cards", () => {
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
          id: "acp:codex",
          label: "Codex",
          meta: "Tiller · main · 空闲",
          status: "ACP",
          runtimeSessionId: "2 个会话",
          children: [
            {
              id: "session-1",
              projectName: "Tiller",
              branchName: "main",
              status: "空闲",
              model: "gpt-5.5",
            },
          ],
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

  assert.match(html, /ACP/);
  assert.match(html, /2 个会话/);
  assert.match(html, /Codex/);
  assert.match(html, /Tiller/);
  assert.match(html, /main · 空闲 · gpt-5.5/);
});
