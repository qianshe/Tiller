import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GitStatusState } from "../../../store/facade";
import { MissionInspector, resolveGitOperationBusy } from "./panel";

const noop = () => undefined;

function renderInspector(gitStatus: GitStatusState): string {
  return renderToStaticMarkup(
    createElement(MissionInspector, {
      collapsed: false,
      style: {},
      activeSessionPresent: true,
      worktreeCount: 1,
      worktreeSummaryLabel: "Tiller / release/0.1.9",
      worktreeList: createElement("div"),
      diffCount: 0,
      selectedDiffCount: 0,
      diffPanel: createElement("div"),
      resizer: createElement("div"),
      gitStatus,
      onCollapse: noop,
    }),
  );
}

test("mission inspector shows Pull and Push counts in the current worktree selector", () => {
  const html = renderInspector({
    projectId: "project-1",
    cwd: "D:/repo",
    branch: "release/0.1.9",
    detached: false,
    ahead: 3,
    behind: 2,
    trackingStale: false,
    clean: true,
    files: [],
  });

  const selectorIndex = html.indexOf('title="选择 Worktree"');
  const pullCountIndex = html.indexOf('aria-label="待 Pull 2 个提交"');
  const pushCountIndex = html.indexOf('aria-label="待 Push 3 个提交"');
  const generateIndex = html.indexOf('aria-label="生成提交描述"');

  assert.ok(selectorIndex >= 0);
  assert.ok(pullCountIndex > selectorIndex);
  assert.ok(pushCountIndex > pullCountIndex);
  assert.ok(generateIndex > pushCountIndex);
});

test("mission inspector hides zero Pull and Push counts", () => {
  const html = renderInspector({
    projectId: "project-1",
    cwd: "D:/repo",
    branch: "release/0.1.9",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: true,
    files: [],
  });

  assert.doesNotMatch(html, /aria-label="待 Pull 0 个提交"/);
  assert.doesNotMatch(html, /aria-label="待 Push 0 个提交"/);
});

test("mission inspector marks stale sync counts with a Fetch hint", () => {
  const html = renderInspector({
    projectId: "project-1",
    cwd: "D:/repo",
    branch: "release/0.1.9",
    detached: false,
    ahead: 1,
    behind: 0,
    trackingStale: true,
    clean: true,
    files: [],
  });

  assert.match(html, /title="远端状态可能已过期，请先 Fetch"/);
  assert.match(html, /aria-label="待 Push 1 个提交"/);
});

test("git operation busy covers store-side pushing/pulling/committing flags", () => {
  const base: GitStatusState = {
    projectId: "project-1",
    cwd: "D:/repo",
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: true,
    files: [],
  };
  const idle = { pulling: false, pushing: false, fetching: false, discarding: false, committing: false };

  assert.equal(resolveGitOperationBusy(base, idle), false);
  assert.equal(resolveGitOperationBusy(undefined, idle), false);

  // Store-side flags must gate operations even when local component state was remounted.
  assert.equal(resolveGitOperationBusy({ ...base, pushing: true }, idle), true);
  assert.equal(resolveGitOperationBusy({ ...base, pulling: true }, idle), true);
  assert.equal(resolveGitOperationBusy({ ...base, committing: true }, idle), true);
  assert.equal(resolveGitOperationBusy({ ...base, discarding: true }, idle), true);
  assert.equal(resolveGitOperationBusy({ ...base, loading: true }, idle), true);

  // Local in-flight flags still count.
  assert.equal(resolveGitOperationBusy(base, { ...idle, committing: true }), true);
  assert.equal(resolveGitOperationBusy(base, { ...idle, fetching: true }), true);
});
