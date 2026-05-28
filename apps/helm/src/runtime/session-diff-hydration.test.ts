import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import type { FileDiffSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { createSessionDiffHydrationService } from "./session-diff-hydration.js";

function createTempGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "tiller-diff-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "file.txt"), "one\n");
  execFileSync("git", ["add", "file.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  writeFileSync(join(root, "file.txt"), "one\ntwo\n");
  return root;
}

function cleanup(path: string) {
  rmSync(path, { recursive: true, force: true });
}

test("diff hydration keeps incoming files when no worktree can be resolved", async () => {
  const service = createSessionDiffHydrationService({
    sessions: new Map(),
    sessionStore: { list: () => [] },
    sessionArtifactStore: { replaceDiffs() {} },
    getProjects: () => [],
    getWorktrees: () => [],
    createHandlerContext: () => ({
      sessionArtifactStore: { replaceDiffs() {} },
      sessionRuntimeStore: { get: () => undefined },
      sessions: new Map(),
      logInfo() {},
      logError() {},
      logWarn() {},
      logDebug() {},
      broadcastNotification() {},
      broadcastSessionTopic() {},
      persistSessionMessage() {},
      updateSessionSummary: () => undefined,
      hydrateSessionSummary: (summary: SessionSummary) => summary,
    }),
  });
  const files: FileDiffSummary[] = [{ path: "file.txt", status: "modified", additions: 1, deletions: 0 }];

  assert.deepEqual(await service.hydrateDiffsFromWorktreeGit("session-1", files), files);
});

test("diff hydration fills additions deletions and patch from git diff", async () => {
  const root = createTempGitRepo();
  try {
    const service = createSessionDiffHydrationService({
      sessions: new Map([
        ["session-1", { worktree: { name: "main", path: root } }],
      ]),
      sessionStore: { list: () => [] },
      sessionArtifactStore: { replaceDiffs() {} },
      getProjects: () => [],
      getWorktrees: () => [{ name: "main", path: root } satisfies WorktreeSummary],
      createHandlerContext: () => ({
        sessionArtifactStore: { replaceDiffs() {} },
        sessionRuntimeStore: { get: () => undefined },
        sessions: new Map(),
        logInfo() {},
        logError() {},
        logWarn() {},
        logDebug() {},
        broadcastNotification() {},
        broadcastSessionTopic() {},
        persistSessionMessage() {},
        updateSessionSummary: () => undefined,
        hydrateSessionSummary: (summary: SessionSummary) => summary,
      }),
    });

    const hydrated = await service.hydrateDiffsFromWorktreeGit("session-1", [{ path: "file.txt", status: "modified", additions: 0, deletions: 0 }]);
    assert.equal(hydrated[0]?.additions > 0, true);
    assert.equal(hydrated[0]?.deletions >= 0, true);
    assert.ok(hydrated[0]?.patch?.includes("+two"));
  } finally {
    cleanup(root);
  }
});

test("diff hydration returns git diffs when incoming files are empty", async () => {
  const root = createTempGitRepo();
  try {
    const service = createSessionDiffHydrationService({
      sessions: new Map([
        ["session-1", { worktree: { name: "main", path: root } }],
      ]),
      sessionStore: { list: () => [] },
      sessionArtifactStore: { replaceDiffs() {} },
      getProjects: () => [],
      getWorktrees: () => [{ name: "main", path: root } satisfies WorktreeSummary],
      createHandlerContext: () => ({
        sessionArtifactStore: { replaceDiffs() {} },
        sessionRuntimeStore: { get: () => undefined },
        sessions: new Map(),
        logInfo() {},
        logError() {},
        logWarn() {},
        logDebug() {},
        broadcastNotification() {},
        broadcastSessionTopic() {},
        persistSessionMessage() {},
        updateSessionSummary: () => undefined,
        hydrateSessionSummary: (summary: SessionSummary) => summary,
      }),
    });

    const hydrated = await service.hydrateDiffsFromWorktreeGit("session-1", []);
    assert.equal(hydrated.length > 0, true);
  } finally {
    cleanup(root);
  }
});
