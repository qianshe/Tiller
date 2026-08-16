import assert from "node:assert/strict";
import test from "node:test";
import type { IssueDetail, IssueSummary, ProjectSummary } from "@tiller/shared";
import { handleIssueRpcRequest } from "./rpc.js";
import type { HelmHandlerContext } from "../context.js";

const issue: IssueSummary = {
  ref: { provider: "github", remoteKey: "qianshe/Tiller", issueId: "42", issueNumber: "7" },
  title: "Fix sync",
  state: "open",
  assignees: [],
  labels: [],
  url: "https://github.com/qianshe/Tiller/issues/7",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-02T00:00:00Z",
};

function contextFor(projects: ProjectSummary[], issueClient?: HelmHandlerContext["issueClient"]) {
  return {
    issueClient,
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    setProjects: () => undefined,
    resolveProjectById: (id: string, items: ProjectSummary[]) => items.find((item) => item.id === id),
  } as unknown as HelmHandlerContext;
}

test("issue handlers list and get through the injected provider", async () => {
  const detail: IssueDetail = { ...issue, body: "Body" };
  const project: ProjectSummary = {
    id: "p1",
    name: "Tiller",
    helmId: "local",
    issueBinding: { provider: "github", remoteKey: "qianshe/Tiller" },
  };
  const context = contextFor([project], {
    list: async () => ({ issues: [issue], nextCursor: "2" }),
    get: async () => detail,
  });

  assert.deepEqual(await handleIssueRpcRequest("issue/list", { projectId: "p1", state: "open" }, context), {
    ok: true,
    projectId: "p1",
    issues: [issue],
    nextCursor: "2",
    message: "Loaded 1 GitHub Issue(s)",
  });
  assert.deepEqual(await handleIssueRpcRequest("issue/get", { projectId: "p1", issueNumber: "7" }, context), {
    ok: true,
    projectId: "p1",
    issue: detail,
    message: "Loaded GitHub Issue detail",
  });
});

test("issue handlers distinguish missing project and missing binding", async () => {
  const missingProject = await handleIssueRpcRequest(
    "issue/list",
    { projectId: "missing" },
    contextFor([]),
  );
  assert.deepEqual(missingProject, {
    ok: false,
    projectId: "missing",
    issues: [],
    message: "Project was not found",
    error: { kind: "project-not-found", message: "Project was not found" },
  });

  const missingBinding = await handleIssueRpcRequest(
    "issue/get",
    { projectId: "p1", issueNumber: "7" },
    contextFor([{ id: "p1", name: "Tiller", helmId: "local" }]),
  );
  assert.deepEqual(missingBinding, {
    ok: false,
    projectId: "p1",
    message: "Project has no GitHub Issue repository binding",
    error: {
      kind: "not-configured",
      message: "Project has no GitHub Issue repository binding",
    },
  });
});

test("issue handlers return provider errors without leaking credentials", async () => {
  const project: ProjectSummary = {
    id: "p1",
    name: "Tiller",
    helmId: "local",
    issueBinding: { provider: "github", remoteKey: "qianshe/Tiller" },
  };
  const context = contextFor([project], {
    list: async () => {
      throw new Error("network offline: secret-token");
    },
    get: async () => {
      throw new Error("unused");
    },
  });

  const result = await handleIssueRpcRequest("issue/list", { projectId: "p1" }, context) as {
    ok: boolean;
    message: string;
    error?: { kind: string };
  };
  assert.equal(result.ok, false);
  assert.equal(result.message, "GitHub Issue request failed");
  assert.equal(result.error?.kind, "network");
  assert.equal(result.message.includes("secret-token"), false);
});
