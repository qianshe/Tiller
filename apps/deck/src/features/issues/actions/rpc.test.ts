import assert from "node:assert/strict";
import test from "node:test";
import type { IssueDetail, IssueSummary } from "@tiller/shared";
import {
  requestIssueDetail,
  requestIssueList,
} from "./rpc";

const issue: IssueSummary = {
  ref: {
    provider: "github",
    remoteKey: "qianshe/Tiller",
    issueId: "123",
    issueNumber: "42",
  },
  title: "Sync dashboard state",
  state: "open",
  author: { id: "1", displayName: "qianshe" },
  assignees: [],
  labels: [{ id: "bug", name: "bug", color: "d73a4a" }],
  url: "https://github.com/qianshe/Tiller/issues/42",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T01:00:00.000Z",
};

test("requestIssueList sends the selected project, filter, and Helm source", async () => {
  const calls: Array<{ method: string; params: unknown; sourceHelmKey?: string }> = [];
  const result = await requestIssueList(
    {} as never,
    async (_client, method, params, options) => {
      calls.push({ method, params, sourceHelmKey: options?.sourceHelmKey });
      return {
        ok: true,
        projectId: "tiller",
        issues: [issue],
        nextCursor: "2",
        message: "Loaded 1 GitHub Issue(s)",
      };
    },
    {
      projectId: "tiller",
      state: "open",
      cursor: "1",
      sourceHelmKey: "127.0.0.1:47631",
    },
  );

  assert.deepEqual(calls, [{
    method: "issue/list",
    params: { projectId: "tiller", state: "open", cursor: "1", limit: 30 },
    sourceHelmKey: "127.0.0.1:47631",
  }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, [issue]);
  assert.equal(result.nextCursor, "2");
});

test("requestIssueDetail returns provider responses and normalizes malformed results", async () => {
  const detail: IssueDetail = { ...issue, body: "## Expected\n\nState changes should sync." };
  const calls: Array<{ method: string; params: unknown; sourceHelmKey?: string }> = [];
  const loaded = await requestIssueDetail(
    {} as never,
    async (_client, method, params, options) => {
      calls.push({ method, params, sourceHelmKey: options?.sourceHelmKey });
      return { ok: true, projectId: "tiller", issue: detail, message: "Loaded GitHub Issue detail" };
    },
    { projectId: "tiller", issueNumber: "42", sourceHelmKey: "127.0.0.1:47631" },
  );
  assert.deepEqual(loaded, {
    ok: true,
    projectId: "tiller",
    issue: detail,
    message: "Loaded GitHub Issue detail",
  });
  assert.deepEqual(calls, [{
    method: "issue/get",
    params: { projectId: "tiller", issueNumber: "42" },
    sourceHelmKey: "127.0.0.1:47631",
  }]);

  const malformed = await requestIssueDetail(
    {} as never,
    async () => ({ ok: true, projectId: "tiller", issue: { title: "incomplete" } }),
    { projectId: "tiller", issueNumber: "42", sourceHelmKey: "127.0.0.1:47631" },
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error?.kind, "invalid-response");
});

test("requestIssueList preserves provider failures for the UI", async () => {
  const failed = await requestIssueList(
    {} as never,
    async () => ({
      ok: false,
      projectId: "tiller",
      issues: [],
      message: "GitHub token is not configured",
      error: { kind: "missing-token", message: "GitHub token is not configured" },
    }),
    { projectId: "tiller", state: "open", sourceHelmKey: "127.0.0.1:47631" },
  );

  assert.equal(failed.ok, false);
  assert.equal(failed.error?.kind, "missing-token");
  assert.equal(failed.message, "GitHub token is not configured");
});
