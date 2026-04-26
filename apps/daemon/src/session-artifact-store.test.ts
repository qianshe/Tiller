import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandChunk, FileDiffSummary } from "@tiller/shared";

test("session artifact store persists command output history and latest diff snapshot", async () => {
  let mod: null | {
    createSessionArtifactStore: (rootDir: string) => {
      appendOutput: (sessionId: string, chunk: CommandChunk) => { outputs: CommandChunk[]; diffs: FileDiffSummary[] };
      replaceDiffs: (sessionId: string, diffs: FileDiffSummary[]) => { outputs: CommandChunk[]; diffs: FileDiffSummary[] };
      get: (sessionId: string) => { outputs: CommandChunk[]; diffs: FileDiffSummary[] };
    };
  } = null;

  try {
    mod = await import("./session-artifact-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionArtifactStore, "createSessionArtifactStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-session-artifact-store-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    const output: CommandChunk = {
      id: "chunk-1",
      commandId: "cmd-1",
      text: "npm test",
      stream: "stdout",
      timestamp: "2026-04-26T12:15:00.000Z",
    };
    const diffs: FileDiffSummary[] = [
      {
        path: "apps/web/src/App.tsx",
        status: "modified",
        additions: 10,
        deletions: 2,
      },
    ];

    store.appendOutput("session-1", output);
    store.replaceDiffs("session-1", diffs);

    const reloadedStore = mod.createSessionArtifactStore(tempRoot);
    const sessionArtifacts = reloadedStore.get("session-1");

    assert.equal(sessionArtifacts.outputs.length, 1);
    assert.deepEqual(sessionArtifacts.outputs[0], output);
    assert.deepEqual(sessionArtifacts.diffs, diffs);
    assert.deepEqual(reloadedStore.get("session-2"), { outputs: [], diffs: [] });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
