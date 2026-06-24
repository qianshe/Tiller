import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitGraphPanel } from "./git-graph-panel.js";
import type { GitGraphState } from "../../../store/slices/projects-slice";

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
