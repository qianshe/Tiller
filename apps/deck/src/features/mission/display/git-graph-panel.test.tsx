import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitGraphPanel } from "./git-graph-panel.js";
import type { GitGraphState } from "../../../store/facade";

const noop = () => undefined;

test("git graph panel renders empty state when no commits", () => {
  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph: { projectId: "test", cwd: "/test", commits: [] },
      onSelectCommit: noop,
    }),
  );

  assert.match(html, /暂无提交记录/);
});

test("git graph panel renders a single-line commit row and exposes hover metadata", () => {
  const gitGraph: GitGraphState = {
    projectId: "test",
    cwd: "/test",
    head: "abc1234",
    commits: [
      {
        hash: "abc1234567890",
        parents: ["def0987654321"],
        refs: [],
        subject: "Add feature X",
        authorName: "John Doe",
        authoredAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        body: "第一条说明\n第二条说明",
        changedFiles: 3,
        insertions: 12,
        deletions: 4,
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph,
      onSelectCommit: noop,
    }),
  );

  assert.match(html, /Add feature X/);
  assert.match(html, /提交历史/);
  assert.match(html, /data-graph-svg/);
  assert.doesNotMatch(html, />作者</);
  assert.doesNotMatch(html, />时间</);
  assert.match(html, /data-state="closed"/);
});

test("git graph panel renders branch refs with correct styling", () => {
  const gitGraph: GitGraphState = {
    projectId: "test",
    cwd: "/test",
    head: "abc1234",
    commits: [
      {
        hash: "abc1234567890",
        parents: [],
        refs: [
          { name: "main", kind: "branch", isCurrent: true },
          { name: "v1.0.0", kind: "tag", isCurrent: false },
        ],
        subject: "Release v1.0.0",
        authorName: "Jane Doe",
        authoredAt: new Date().toISOString(),
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph,
      onSelectCommit: noop,
    }),
  );

  assert.match(html, /HEAD.*main/);
  assert.match(html, /v1\.0\.0/);
});

test("git graph panel renders merge commit indicator for multiple parents", () => {
  const gitGraph: GitGraphState = {
    projectId: "test",
    cwd: "/test",
    commits: [
      {
        hash: "merge1234567",
        parents: ["parent1", "parent2"],
        refs: [],
        subject: "Merge branch feature",
        authorName: "Merger",
        authoredAt: new Date().toISOString(),
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph,
      onSelectCommit: noop,
    }),
  );

  assert.match(html, /data-merge-commit="true"/);
  assert.match(html, /data-graph-svg/);
});

test("git graph panel does not render commit hashes in the list body", () => {
  const gitGraph: GitGraphState = {
    projectId: "test",
    cwd: "/test",
    commits: [
      {
        hash: "abc1234567890def",
        parents: [],
        refs: [],
        subject: "Test commit",
        authorName: "Tester",
        authoredAt: new Date().toISOString(),
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph,
      onSelectCommit: noop,
    }),
  );

  assert.doesNotMatch(html, /abc1234/);
  assert.match(html, /Test commit/);
});

test("git graph panel exposes a click trigger on each commit row for mobile detail expansion", () => {
  const gitGraph: GitGraphState = {
    projectId: "test",
    cwd: "/test",
    head: "abc1234",
    commits: [
      {
        hash: "abc1234567890",
        parents: [],
        refs: [],
        subject: "Add feature X",
        authorName: "John Doe",
        authoredAt: new Date().toISOString(),
        body: "第一条说明",
        changedFiles: 3,
        insertions: 12,
        deletions: 4,
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph,
      onSelectCommit: noop,
    }),
  );

  // 每行带可点击触发器与 aria 属性,移动端点击即可展开详情
  assert.match(html, /data-commit-index="0"/);
  assert.match(html, /aria-expanded="false"/);
  // 初始折叠:行内不展示作者/时间等详情块
  assert.doesNotMatch(html, /data-commit-index[\s\S]*>作者</);
});

test("git graph panel expands commit detail inline when a commit is preselected", () => {
  const gitGraph: GitGraphState = {
    projectId: "test",
    cwd: "/test",
    head: "abc1234",
    commits: [
      {
        hash: "abc1234567890",
        parents: [],
        refs: [],
        subject: "Add feature X",
        authorName: "John Doe",
        authoredAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(GitGraphPanel, {
      gitGraph,
      selectedCommitHash: "abc1234567890",
      onSelectCommit: noop,
    }),
  );

  // 预选中提交时,详情块就地展开,作者/时间/哈希可见
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /作者/);
  assert.match(html, /John Doe/);
  assert.match(html, /abc1234567890/);
});
