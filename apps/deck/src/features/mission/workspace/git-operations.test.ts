import assert from "node:assert/strict";
import test from "node:test";
import { createGitStatusState, type GitStatusState } from "../../../store/facade";
import type { GitDispatchResult } from "./git-sync.js";
import {
  resolveFetchOutcome,
  runGitFileDiffs,
  runGitCommit,
  runGitDiscard,
  runGitFetch,
  runGitPush,
  runGitRefresh,
  type GitOperationContext,
} from "./git-operations.js";

type NotifyRecord = { kind: "success" | "warning" | "error"; message: string };

function createTestContext(options: {
  dispatch: (method: string, params: Record<string, unknown>) => Promise<GitDispatchResult>;
  hasGraph?: boolean;
  withGraphPatch?: boolean;
  graphSignature?: string;
}) {
  const statusSnapshots: GitStatusState[] = [];
  const graphPatches: Array<{ loading: boolean; message?: string; error?: string }> = [];
  const notifications: NotifyRecord[] = [];
  const commitSuccesses: number[] = [];
  const discardedPaths: string[][] = [];
  let status = createGitStatusState("p1", "/repo");

  const context: GitOperationContext = {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: options.hasGraph ?? false,
    graphSignature: options.graphSignature,
    dispatch: options.dispatch,
    updateStatus: (updater) => {
      status = updater(status);
      statusSnapshots.push(status);
    },
    patchGraph: options.withGraphPatch
      ? (patch) => graphPatches.push(patch)
      : undefined,
    notify: {
      success: (message) => notifications.push({ kind: "success", message }),
      warning: (message) => notifications.push({ kind: "warning", message }),
      error: (message) => notifications.push({ kind: "error", message }),
    },
    onCommitSuccess: () => commitSuccesses.push(1),
    onDiscardSuccess: (paths) => discardedPaths.push(paths),
  };

  return {
    context,
    statusSnapshots,
    graphPatches,
    notifications,
    commitSuccesses,
    discardedPaths,
    currentStatus: () => status,
  };
}

test("resolveFetchOutcome treats remoteRefreshError as failure even when ok is true", () => {
  assert.deepEqual(resolveFetchOutcome({ ok: true }), { ok: true });
  assert.deepEqual(
    resolveFetchOutcome({ ok: true, remoteRefreshError: "network unreachable" }),
    { ok: false, errorMessage: "network unreachable" },
  );
  assert.deepEqual(
    resolveFetchOutcome({ ok: false, message: "not a git repo" }),
    { ok: false, errorMessage: "not a git repo" },
  );
  assert.deepEqual(resolveFetchOutcome(undefined), { ok: false, errorMessage: undefined });
});

test("runGitFetch does not announce success when remote refresh failed", async () => {
  const harness = createTestContext({
    dispatch: async () => ({ ok: true, remoteRefreshError: "origin unavailable" }),
  });

  const result = await runGitFetch(harness.context);

  assert.equal(result?.ok, true);
  assert.equal(
    harness.notifications.some((item) => item.kind === "success"),
    false,
  );
  assert.deepEqual(harness.notifications, [
    { kind: "error", message: "Fetch 失败：origin unavailable" },
  ]);
});

test("runGitFetch announces success when remote refresh completed", async () => {
  const harness = createTestContext({
    dispatch: async () => ({ ok: true }),
  });

  await runGitFetch(harness.context);

  assert.deepEqual(harness.notifications, [
    { kind: "success", message: "Fetch 成功" },
  ]);
});

test("runGitRefresh clears graph loading when status returns ok=false", async () => {
  const harness = createTestContext({
    dispatch: async () => ({ ok: false, message: "not a git repo" }),
    hasGraph: true,
    withGraphPatch: true,
  });

  const result = await runGitRefresh(harness.context, { refreshRemote: false });

  assert.equal(result?.ok, false);
  assert.deepEqual(harness.graphPatches, [
    { loading: true },
    { loading: false, message: "not a git repo", error: "not a git repo" },
  ]);
});

test("runGitRefresh clears status and graph loading when dispatch throws", async () => {
  const harness = createTestContext({
    dispatch: async () => {
      throw new Error("socket closed");
    },
    hasGraph: true,
    withGraphPatch: true,
  });

  const result = await runGitRefresh(harness.context, { refreshRemote: true });

  assert.deepEqual(result, { ok: false, message: "socket closed" });
  assert.equal(harness.currentStatus().loading, false);
  assert.equal(harness.currentStatus().error, "socket closed");
  assert.deepEqual(harness.graphPatches.at(-1), {
    loading: false,
    message: "socket closed",
    error: "socket closed",
  });
});

test("runGitRefresh forwards the cached graph signature to the graph dispatch", async () => {
  const graphParams: Array<Record<string, unknown>> = [];
  const harness = createTestContext({
    dispatch: async (method, params) => {
      if (method === "project/git/graph") {
        graphParams.push(params);
      }
      return { ok: true };
    },
    hasGraph: true,
    withGraphPatch: true,
    graphSignature: "sig-1",
  });

  await runGitRefresh(harness.context, { refreshRemote: false });

  assert.equal(graphParams.length, 1);
  assert.equal(graphParams[0]?.knownSignature, "sig-1");
});

test("runGitCommit refreshes the graph with the cached signature", async () => {
  const graphParams: Array<Record<string, unknown>> = [];
  const harness = createTestContext({
    dispatch: async (method, params) => {
      if (method === "project/git/graph") {
        graphParams.push(params);
      }
      return { ok: true };
    },
    hasGraph: true,
    graphSignature: "sig-1",
  });

  await runGitCommit(harness.context, { message: "fix：test", paths: ["a.ts"] });

  assert.equal(graphParams.length, 1);
  assert.equal(graphParams[0]?.knownSignature, "sig-1");
});

test("runGitPush toggles pushing flag and refreshes status after success", async () => {
  const dispatched: string[] = [];
  let pushingDuringDispatch: boolean | undefined;
  const harness = createTestContext({
    dispatch: async (method) => {
      dispatched.push(method);
      if (method === "project/git/push") {
        pushingDuringDispatch = harness.currentStatus().pushing;
      }
      return { ok: true };
    },
  });

  await runGitPush(harness.context);

  assert.equal(pushingDuringDispatch, true);
  assert.equal(harness.currentStatus().pushing, false);
  assert.deepEqual(dispatched, ["project/git/push", "project/git/status"]);
  assert.deepEqual(harness.notifications, [
    { kind: "success", message: "Push 成功" },
  ]);
});

test("runGitPush warns when the follow-up refresh fails", async () => {
  const harness = createTestContext({
    dispatch: async (method) => {
      if (method === "project/git/push") {
        return { ok: true };
      }
      return { ok: false, message: "status unavailable" };
    },
  });

  await runGitPush(harness.context);

  assert.deepEqual(harness.notifications, [
    { kind: "warning", message: "Push 已完成，但 Git 状态刷新失败" },
  ]);
});

test("runGitCommit clears selection and refreshes graph on success", async () => {
  const dispatched: string[] = [];
  const harness = createTestContext({
    dispatch: async (method) => {
      dispatched.push(method);
      return { ok: true };
    },
    hasGraph: true,
  });

  await runGitCommit(harness.context, { message: "fix：test", paths: ["a.ts"] });

  assert.equal(harness.commitSuccesses.length, 1);
  assert.deepEqual(dispatched, ["project/git/commit", "project/git/graph"]);
  assert.equal(harness.currentStatus().committing, false);
});

test("runGitCommit keeps selection when commit fails", async () => {
  const harness = createTestContext({
    dispatch: async () => ({ ok: false, message: "nothing to commit" }),
    hasGraph: true,
  });

  const result = await runGitCommit(harness.context, { message: "fix：test", paths: ["a.ts"] });

  assert.equal(result?.ok, false);
  assert.equal(harness.commitSuccesses.length, 0);
  assert.equal(harness.currentStatus().committing, false);
});

test("runGitFileDiffs dispatches an on-demand batched patch request", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];
  const harness = createTestContext({
    dispatch: async (method, params) => {
      dispatched.push({ method, params });
      return { ok: true };
    },
  });

  const result = await runGitFileDiffs(harness.context, ["src/a.ts", "src/b.ts"]);

  assert.equal(result?.ok, true);
  assert.deepEqual(dispatched, [{
    method: "project/git/file_diff",
    params: { projectId: "p1", cwd: "/repo", paths: ["src/a.ts", "src/b.ts"] },
  }]);
});

test("runGitFileDiffs refuses an empty path list without dispatching", async () => {
  const dispatched: string[] = [];
  const harness = createTestContext({
    dispatch: async (method) => {
      dispatched.push(method);
      return { ok: true };
    },
  });

  const result = await runGitFileDiffs(harness.context, []);

  assert.equal(result?.ok, false);
  assert.equal(dispatched.length, 0);
});

test("runGitDiscard reports discarded paths on success", async () => {
  const harness = createTestContext({
    dispatch: async () => ({ ok: true }),
  });

  await runGitDiscard(harness.context, ["a.ts", "b.ts"]);

  assert.deepEqual(harness.discardedPaths, [["a.ts", "b.ts"]]);
  assert.equal(harness.currentStatus().discarding, false);
  assert.deepEqual(harness.notifications, [
    { kind: "success", message: "已丢弃选中改动" },
  ]);
});
