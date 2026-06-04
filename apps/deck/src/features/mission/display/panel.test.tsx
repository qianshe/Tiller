import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionDisplayPanel } from "./panel.js";

const noop = () => undefined;

test("mission display panel focuses on diff detail and custom pages", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [
        { id: "diff-detail", title: "Diff 详情" },
        { id: "custom-1", title: "自定义" },
      ],
      selectedPage: { id: "diff-detail", title: "Diff 详情" },
      openedDiffFilePaths: ["docs/redesign/mission-v5.html"],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: null,
      diffs: [
        {
          path: "docs/redesign/mission-v5.html",
          status: "modified",
          additions: 12,
          deletions: 4,
          patch: "",
        },
      ],
      noDiffSummary: "还没有文件变更。",
      logbookContent: null,
      onAddPage: noop,
      onSelectPage: noop,
      onDragStart: noop,
      onDrop: noop,
      onRenamePage: noop,
      onMovePage: noop,
      onDeletePage: noop,
      onOpenDiffDetail: noop,
      onCloseDiffFile: noop,
      onCollapse: noop,
    }),
  );

  assert.match(html, /mission-v5\.html/);
  assert.match(html, /docs\/redesign\/mission-v5\.html/);
  assert.doesNotMatch(html, /Diff 详情/);
  assert.doesNotMatch(html, /自定义/);
  assert.doesNotMatch(html, /新增展示页/);
  assert.doesNotMatch(html, /mission-diff-file-summary/);
  assert.doesNotMatch(html, /概览/);
  assert.doesNotMatch(html, /航行日志/);
  assert.doesNotMatch(html, /mission-overview-page/);
  assert.doesNotMatch(html, /mission-runtime-overview/);
});

test("mission display panel does not reopen a closed diff implicitly", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "diff-detail", title: "Diff 详情" }],
      selectedPage: { id: "diff-detail", title: "Diff 详情" },
      openedDiffFilePaths: [],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: null,
      diffs: [
        {
          path: "apps/deck/src/app.tsx",
          status: "modified",
          additions: 3,
          deletions: 1,
          patch: "diff --git a/apps/deck/src/app.tsx b/apps/deck/src/app.tsx",
        },
      ],
      noDiffSummary: "未选择文件。",
      logbookContent: null,
      onAddPage: noop,
      onSelectPage: noop,
      onDragStart: noop,
      onDrop: noop,
      onRenamePage: noop,
      onMovePage: noop,
      onDeletePage: noop,
      onOpenDiffDetail: noop,
      onCloseDiffFile: noop,
      onCollapse: noop,
    }),
  );

  assert.doesNotMatch(html, /app\.tsx/);
  assert.doesNotMatch(html, /diff --git/);
  assert.match(html, /未选择文件。/);
});

test("mission display panel keeps the v6 empty diff viewer chrome", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "diff-detail", title: "Diff 详情" }],
      selectedPage: { id: "diff-detail", title: "Diff 详情" },
      openedDiffFilePaths: [],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: null,
      diffs: [],
      noDiffSummary: "还没有文件变更。",
      logbookContent: null,
      onAddPage: noop,
      onSelectPage: noop,
      onDragStart: noop,
      onDrop: noop,
      onRenamePage: noop,
      onMovePage: noop,
      onDeletePage: noop,
      onOpenDiffDetail: noop,
      onCloseDiffFile: noop,
      onCollapse: noop,
    }),
  );

  assert.match(html, /展示栏/);
  assert.doesNotMatch(html, /mission-v5\.html/);
  assert.doesNotMatch(html, /docs\/redesign\/mission-v5\.html/);
  assert.doesNotMatch(html, /Diff 详情/);
  assert.doesNotMatch(html, /自定义/);
  assert.doesNotMatch(html, /新增展示页/);
  assert.doesNotMatch(html, /mission-diff-file-summary/);
  assert.doesNotMatch(html, /概览/);
  assert.match(html, /展示栏/);
  assert.doesNotMatch(html, /新增展示页/);
  assert.doesNotMatch(html, /Diff 详情/);
  assert.match(html, /还没有文件变更。/);
});

test("mission display panel hides stale file paths when there are no diffs", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "diff-detail", title: "Diff 详情" }],
      selectedPage: { id: "diff-detail", title: "Diff 详情" },
      openedDiffFilePaths: ["apps/deck/src/features/mission/conversation/chat-pane.tsx"],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: "apps/deck/src/features/mission/conversation/chat-pane.tsx",
      diffs: [],
      noDiffSummary: "还没有文件变更。",
      logbookContent: null,
      onAddPage: noop,
      onSelectPage: noop,
      onDragStart: noop,
      onDrop: noop,
      onRenamePage: noop,
      onMovePage: noop,
      onDeletePage: noop,
      onOpenDiffDetail: noop,
      onCloseDiffFile: noop,
      onCollapse: noop,
    }),
  );

  assert.match(html, /还没有文件变更。/);
  assert.match(html, /未选择文件/);
  assert.doesNotMatch(html, /chat-pane\.tsx/);
});
