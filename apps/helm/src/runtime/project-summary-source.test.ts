import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProjectSummarySource } from "./project-summary-source.js";

function createProjectRoot() {
  return mkdtempSync(join(tmpdir(), "tiller-summary-source-"));
}

test("loadProjectSummarySource reads an explicit project summary file", async () => {
  const root = createProjectRoot();
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "context.md"), "# Context\nUse this file.", "utf8");

  const result = await loadProjectSummarySource({
    project: {
      id: "project-1",
      name: "Tiller",
      helmId: "local-helm",
      path: root,
      summaryFile: "docs/context.md",
    },
    worktrees: [],
  });

  assert.equal(result?.path, "docs/context.md");
  assert.match(result?.content ?? "", /Use this file/u);
});

test("loadProjectSummarySource falls back to default project docs", async () => {
  const root = createProjectRoot();
  writeFileSync(join(root, "CLAUDE.md"), "# Claude\nProject instructions.", "utf8");
  writeFileSync(join(root, "README.md"), "# Readme\nLower priority.", "utf8");

  const result = await loadProjectSummarySource({
    project: {
      id: "project-1",
      name: "Tiller",
      helmId: "local-helm",
      path: root,
    },
    worktrees: [],
  });

  assert.equal(result?.path, "CLAUDE.md");
  assert.match(result?.content ?? "", /Project instructions/u);
});

test("loadProjectSummarySource rejects paths outside the project root", async () => {
  const root = createProjectRoot();

  const result = await loadProjectSummarySource({
    project: {
      id: "project-1",
      name: "Tiller",
      helmId: "local-helm",
      path: root,
      summaryFile: "../outside.md",
      summary: "manual fallback",
    },
    worktrees: [],
  });

  assert.equal(result?.path, "<configured-summary>");
  assert.equal(result?.content, "manual fallback");
});

test("loadProjectSummarySource rejects absolute summary file paths", async () => {
  const root = createProjectRoot();
  mkdirSync(join(root, "etc"), { recursive: true });
  writeFileSync(join(root, "etc", "passwd"), "should not read", "utf8");

  const result = await loadProjectSummarySource({
    project: {
      id: "project-1",
      name: "Tiller",
      helmId: "local-helm",
      path: root,
      summaryFile: "/etc/passwd",
      summary: "manual fallback",
    },
    worktrees: [],
  });

  assert.equal(result?.path, "<configured-summary>");
  assert.equal(result?.content, "manual fallback");
});
