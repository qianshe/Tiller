import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const worktreeListSource = readFileSync(resolve(currentDir, "worktree-list.tsx"), "utf8");

test("MissionWorktreeList renders selected session worktree summaries first", () => {
  assert.match(worktreeListSource, /selectedSessionWorktreeItems\.length/);
  assert.match(worktreeListSource, /branch\?: string \| null;/);
  assert.match(worktreeListSource, /item\.projectName/);
  assert.match(worktreeListSource, /\{item\.branchName\}/);
  assert.match(worktreeListSource, /\{item\.cwd\}/);
});

test("MissionWorktreeList renders empty state when no cwd is available", () => {
  assert.match(worktreeListSource, /当前选中会话暂无 cwd \/ 分支记录。/);
});

test("MissionWorktreeList closes the inspector picker after a worktree selection", () => {
  assert.match(worktreeListSource, /onClose\?: \(\) => void;/);
  assert.match(
    worktreeListSource,
    /onClick=\{\(\) => \{\s*onSelectCwd\(item\.cwd\);\s*onClose\?\.\(\);\s*\}\}/s,
  );
  assert.match(
    worktreeListSource,
    /onClick=\{\(\) => \{\s*onSelectCwd\(worktree\.path\);\s*onClose\?\.\(\);\s*\}\}/s,
  );
  assert.doesNotMatch(worktreeListSource, /连接/);
});
