import assert from "node:assert/strict";
import test from "node:test";
import * as projectListFiles from "./project/list-files";
import * as workspaceGitListBranches from "./workspace/git/list-branches";
import * as workspaceGitCreateBranch from "./workspace/git/create-branch";
import * as agentGetModelOptions from "./agent/get-model-options";
import * as agentSave from "./agent/save";
import * as permissionRespond from "./permission/respond";

test("project/list_files validates required projectId", () => {
  assert.equal(projectListFiles.method, "project/list_files");
  assert.deepEqual(
    projectListFiles.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );
  assert.throws(() => projectListFiles.ParamsSchema.parse({}));
});

test("workspace/git/list_branches result matches expected shape", () => {
  assert.equal(workspaceGitListBranches.method, "workspace/git/list_branches");
  const ok = workspaceGitListBranches.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    branches: ["main"],
    workspaces: [],
    message: "",
  });
  assert.equal(ok.ok, true);
});

test("workspace/git/create_branch shares the list_branches result schema", () => {
  assert.equal(workspaceGitCreateBranch.method, "workspace/git/create_branch");
  workspaceGitCreateBranch.ResultSchema.parse({
    ok: false,
    projectId: "p1",
    branches: [],
    workspaces: [],
    message: "no git repo",
  });
});

test("agent/get_model_options enforces id triple", () => {
  assert.equal(agentGetModelOptions.method, "agent/get_model_options");
  assert.deepEqual(
    agentGetModelOptions.ParamsSchema.parse({
      providerId: "claude",
      workspaceId: "ws1",
    }),
    { providerId: "claude", workspaceId: "ws1" },
  );
});

test("agent/save expects provider and reports providerId", () => {
  assert.equal(agentSave.method, "agent/save");
  agentSave.ParamsSchema.parse({ provider: { id: "x" } });
  assert.deepEqual(
    agentSave.ResultSchema.parse({ ok: true, providerId: "x", message: "saved" }),
    { ok: true, providerId: "x", message: "saved" },
  );
});

test("permission/respond echoes id and decision", () => {
  assert.equal(permissionRespond.method, "permission/respond");
  assert.deepEqual(
    permissionRespond.ResultSchema.parse({
      ok: true,
      permissionRequestId: "pr1",
      decision: { kind: "allow" },
    }),
    { ok: true, permissionRequestId: "pr1", decision: { kind: "allow" } },
  );
});
