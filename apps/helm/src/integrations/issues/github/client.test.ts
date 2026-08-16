import assert from "node:assert/strict";
import test from "node:test";
import { createGithubIssueClient } from "./client.js";
import { GithubIssueProviderError } from "./errors.js";

const binding = { provider: "github" as const, remoteKey: "qianshe/Tiller" };

function response(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("GitHub Issue client maps list fields, filters pull requests, and follows next cursor", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const client = createGithubIssueClient({
    token: "secret-token",
    fetchFn: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return response([
        {
          id: 42,
          number: 7,
          title: "Fix sync",
          state: "open",
          user: { id: 10, login: "qianshe" },
          assignees: [{ id: 11, login: "reviewer" }],
          labels: [{ id: 12, name: "bug", color: "b60205" }],
          html_url: "https://github.com/qianshe/Tiller/issues/7",
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-02T00:00:00Z",
        },
        {
          id: 43,
          number: 8,
          title: "Pull request",
          state: "open",
          pull_request: { url: "https://api.github.com/repos/qianshe/Tiller/pulls/8" },
        },
      ], {
        headers: {
          link: '<https://api.github.com/repos/qianshe/Tiller/issues?page=3>; rel="next"',
        },
      });
    },
  });

  const result = await client.list({ binding, state: "open", limit: 2, cursor: "2" });

  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0], {
    ref: { provider: "github", remoteKey: "qianshe/Tiller", issueId: "42", issueNumber: "7" },
    title: "Fix sync",
    state: "open",
    author: { id: "10", displayName: "qianshe" },
    assignees: [{ id: "11", displayName: "reviewer" }],
    labels: [{ id: "12", name: "bug", color: "b60205" }],
    url: "https://github.com/qianshe/Tiller/issues/7",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
  });
  assert.equal(result.nextCursor, "3");
  assert.match(requests[0]?.url ?? "", /state=open/);
  assert.match(requests[0]?.url ?? "", /page=2/);
  assert.equal(requests[0]?.authorization, "Bearer secret-token");
});

test("GitHub Issue client returns detail body only for get", async () => {
  const client = createGithubIssueClient({
    token: "secret-token",
    fetchFn: async () => response({
      id: 42,
      number: 7,
      title: "Fix sync",
      state: "closed",
      body: "Detailed body",
      user: { id: 10, login: "qianshe" },
      assignees: [],
      labels: [],
      html_url: "https://github.com/qianshe/Tiller/issues/7",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-02T00:00:00Z",
    }),
  });

  const issue = await client.get({ binding, issueNumber: "7" });

  assert.equal(issue.body, "Detailed body");
  assert.equal(issue.state, "closed");
});

test("GitHub Issue client maps authentication, rate limit, and missing token errors", async () => {
  await assert.rejects(
    () => createGithubIssueClient({ fetchFn: async () => response([]) }).list({ binding }),
    (error: unknown) => error instanceof GithubIssueProviderError && error.kind === "missing-token",
  );

  const rateLimited = createGithubIssueClient({
    token: "secret-token",
    fetchFn: async () => response({ message: "rate limited" }, {
      status: 429,
      headers: { "retry-after": "12" },
    }),
  });
  await assert.rejects(
    () => rateLimited.list({ binding }),
    (error: unknown) =>
      error instanceof GithubIssueProviderError &&
      error.kind === "rate-limited" &&
      error.retryAfterSeconds === 12,
  );
});

test("GitHub Issue client rejects invalid repository bindings before network access", async () => {
  let called = false;
  const client = createGithubIssueClient({
    token: "secret-token",
    fetchFn: async () => {
      called = true;
      return response([]);
    },
  });

  await assert.rejects(
    () => client.list({ binding: { provider: "github", remoteKey: "not-a-repository" } }),
    (error: unknown) => error instanceof GithubIssueProviderError && error.kind === "not-configured",
  );
  assert.equal(called, false);
});
