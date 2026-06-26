import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionDisplayPanel } from "./panel.js";

const noop = () => undefined;

test("mission display panel focuses on diff detail with single-layer tabs", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [
        { id: "graph", title: "Graph" },
        { id: "diff:docs/redesign/mission-v5.html", title: "mission-v5.html" },
      ],
      selectedPage: { id: "diff:docs/redesign/mission-v5.html", title: "mission-v5.html" },
      openedDiffFilePaths: ["docs/redesign/mission-v5.html"],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: "docs/redesign/mission-v5.html",
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
  assert.match(html, /Graph/);
  assert.doesNotMatch(html, /Git 状态/);
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
      pages: [
        { id: "graph", title: "Graph" },
      ],
      selectedPage: { id: "graph", title: "Graph" },
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
  assert.match(html, /git-graph-panel/);
});

test("mission display panel keeps diff tabs visible while graph is selected", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "graph", title: "Graph" }],
      selectedPage: { id: "graph", title: "Graph" },
      openedDiffFilePaths: ["apps/deck/src/app.tsx"],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: "apps/deck/src/app.tsx",
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

  assert.match(html, /Graph/);
  assert.match(html, /app\.tsx/);
  assert.match(html, /git-graph-panel/);
  assert.equal((html.match(/bg-surface-emphasis text-foreground/g) ?? []).length, 1);
});

test("mission display panel keeps the v6 empty diff viewer chrome", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [
        { id: "graph", title: "Graph" },
      ],
      selectedPage: { id: "graph", title: "Graph" },
      openedDiffFilePaths: [],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: null,
      diffs: [],
      noDiffSummary: "还没有文件变更。",
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
  assert.match(html, /Graph/);
  assert.doesNotMatch(html, /Git 状态/);
  assert.doesNotMatch(html, /自定义/);
  assert.doesNotMatch(html, /新增展示页/);
  assert.doesNotMatch(html, /mission-diff-file-summary/);
  assert.doesNotMatch(html, /概览/);
  assert.match(html, /展示栏/);
  assert.doesNotMatch(html, /新增展示页/);
});

test("mission display panel shows graph loading state instead of empty history while loading", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [{ id: "graph", title: "Graph" }],
      selectedPage: { id: "graph", title: "Graph" },
      openedDiffFilePaths: [],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: null,
      diffs: [],
      gitGraph: {
        projectId: "project-1",
        cwd: "D:/repo",
        commits: [],
        loading: true,
        message: "正在加载提交历史...",
      },
      noDiffSummary: "还没有文件变更。",
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

  assert.match(html, /正在加载提交历史/);
  assert.doesNotMatch(html, /暂无提交记录/);
});

test("mission display panel hides stale file paths when there are no diffs", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [
        { id: "graph", title: "Graph" },
      ],
      selectedPage: { id: "graph", title: "Graph" },
      openedDiffFilePaths: ["apps/deck/src/features/mission/conversation/chat-pane.tsx"],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: "apps/deck/src/features/mission/conversation/chat-pane.tsx",
      diffs: [],
      noDiffSummary: "还没有文件变更。",
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

  assert.match(html, /git-graph-panel/);
  assert.doesNotMatch(html, /chat-pane\.tsx/);
});

test("mission display panel renders diff tabs when diff selected", () => {
  const html = renderToStaticMarkup(
    createElement(MissionDisplayPanel, {
      style: {},
      pages: [
        { id: "graph", title: "Graph" },
        { id: "diff:apps/deck/src/app.tsx", title: "app.tsx" },
      ],
      selectedPage: { id: "diff:apps/deck/src/app.tsx", title: "app.tsx" },
      openedDiffFilePaths: ["apps/deck/src/app.tsx"],
      overviewItems: [],
      runtimeOverviewItems: [],
      selectedDiffFilePath: "apps/deck/src/app.tsx",
      diffs: [
        {
          path: "apps/deck/src/app.tsx",
          status: "modified",
          additions: 3,
          deletions: 1,
          patch: "diff --git a/apps/deck/src/app.tsx b/apps/deck/src/app.tsx\nindex abc..def 100644\n--- a/apps/deck/src/app.tsx\n+++ b/apps/deck/src/app.tsx\n@@ -1,5 +1,7 @@\n const x = 1;\n-const y = 2;\n+const y = 3;\n+const z = 4;\n const a = 5;",
        },
      ],
      noDiffSummary: "未选择文件。",
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

  assert.match(html, /Graph/);
  assert.match(html, /app\.tsx/);
  assert.match(html, /const y = 3/);
  assert.doesNotMatch(html, /Git 状态/);
  assert.match(html, /apps\/deck\/src\/app\.tsx/);
});
