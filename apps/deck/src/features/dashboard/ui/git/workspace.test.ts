import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FileDiffSummary } from "@tiller/shared";
import {
  resolveDashboardGitMobilePane,
  resolveDashboardGitSelectedFilePath,
} from "./selection";

const workspaceSource = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

const files = [
  { path: "src/app.ts", status: "modified", additions: 1, deletions: 0 },
  { path: "README.md", status: "added", additions: 4, deletions: 0 },
] satisfies FileDiffSummary[];

test("Dashboard Git keeps the detail pane empty until a file is selected", () => {
  assert.equal(resolveDashboardGitSelectedFilePath(null, files), null);
});

test("Dashboard Git preserves a valid selection and clears stale selections", () => {
  assert.equal(resolveDashboardGitSelectedFilePath("src/app.ts", files), "src/app.ts");
  assert.equal(resolveDashboardGitSelectedFilePath("missing.ts", files), null);
});

test("Dashboard Git keeps history as a separate mobile pane", () => {
  assert.equal(resolveDashboardGitMobilePane("changes", false), "changes");
  assert.equal(resolveDashboardGitMobilePane("detail", false), "detail");
  assert.equal(resolveDashboardGitMobilePane("detail", true), "history");
});

test("Dashboard Git exposes a collapsible mobile scope toolbar", () => {
  assert.match(workspaceSource, /mobileScopeOpen/);
  assert.match(workspaceSource, /aria-controls="dashboard-git-mobile-scope"/);
  assert.match(workspaceSource, /收起 Git 范围选择/);
  assert.match(workspaceSource, /展开 Git 范围选择/);
});

test("Dashboard Git aligns desktop project metadata on one content column", () => {
  assert.match(workspaceSource, /grid-cols-\[14px_minmax\(0,1fr\)\]/);
  assert.match(workspaceSource, /ml-auto min-w-0 max-w-\[min\(42rem,100%\)\] shrink px-1/);
  assert.doesNotMatch(workspaceSource, /text-right/);
});

test("Dashboard Git keeps desktop scope labels beside their selectors", () => {
  assert.match(workspaceSource, /GitScopeSelect inline label="项目"/);
  assert.match(workspaceSource, /GitScopeSelect inline label="Worktree"/);
  assert.match(workspaceSource, /inline \? "flex min-w-\[220px\] items-center gap-2/);
});
