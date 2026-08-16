import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_REQUEST_METHODS, METHODS, validateParams, validateResult } from "../../index";

test("issue list and get methods are registered as client requests", () => {
  assert.equal(CLIENT_REQUEST_METHODS.includes("issue/list"), true);
  assert.equal(CLIENT_REQUEST_METHODS.includes("issue/get"), true);
  assert.equal(METHODS["issue/list"]?.kind, "request");
  assert.equal(METHODS["issue/get"]?.kind, "request");
});

test("issue methods validate project and pagination inputs", () => {
  assert.deepEqual(validateParams("issue/list", { projectId: "p1", state: "all", cursor: "2" }), {
    projectId: "p1",
    state: "all",
    cursor: "2",
  });
  assert.deepEqual(validateParams("issue/get", { projectId: "p1", issueNumber: "12" }), {
    projectId: "p1",
    issueNumber: "12",
  });
  assert.throws(() => validateParams("issue/get", { projectId: "p1", issueNumber: "pull/12" }));
});

test("issue result schemas preserve safe error metadata", () => {
  assert.deepEqual(
    validateResult("issue/list", {
      ok: false,
      projectId: "p1",
      issues: [],
      message: "GitHub token is not configured",
      error: { kind: "missing-token", message: "GitHub token is not configured" },
    }),
    {
      ok: false,
      projectId: "p1",
      issues: [],
      message: "GitHub token is not configured",
      error: { kind: "missing-token", message: "GitHub token is not configured" },
    },
  );
});
