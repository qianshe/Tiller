import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IssueDetail, ProjectSummary } from "@tiller/shared";
import { IssueDetailPane, IssuesWorkspace } from "./workspace";

const configuredProject: ProjectSummary = {
  id: "tiller",
  name: "Tiller",
  helmId: "local",
  issueBinding: { provider: "github", remoteKey: "qianshe/Tiller" },
};

const issue: IssueDetail = {
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
  body: "## Expected\n\nState changes should sync.",
};

test("IssuesWorkspace distinguishes missing projects from unbound GitHub repositories", () => {
  const noProjects = renderToStaticMarkup(createElement(IssuesWorkspace, {
    currentHelmKey: "127.0.0.1:47631",
    connection: "connected",
    projects: [],
    client: null,
    dispatch: async () => undefined,
  }));
  assert.match(noProjects, /暂无项目/);

  const unbound = renderToStaticMarkup(createElement(IssuesWorkspace, {
    currentHelmKey: "127.0.0.1:47631",
    connection: "connected",
    projects: [{ ...configuredProject, issueBinding: undefined }],
    client: null,
    dispatch: async () => undefined,
  }));
  assert.match(unbound, /尚未绑定 GitHub 仓库/);
  assert.match(unbound, /owner\/repo/);
});

test("IssueDetailPane renders GitHub Issue metadata and sanitized Markdown body", () => {
  const html = renderToStaticMarkup(createElement(IssueDetailPane, {
    issue,
    loading: false,
    error: undefined,
  }));

  assert.match(html, /#42/);
  assert.match(html, /Sync dashboard state/);
  assert.match(html, /qianshe/);
  assert.match(html, /bug/);
  assert.match(html, /Expected/);
  assert.match(html, /State changes should sync/);
  assert.match(html, /打开 GitHub/);
});
