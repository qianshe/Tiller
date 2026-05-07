import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_NOTIFICATION_METHODS,
  CLIENT_REQUEST_METHODS,
  METHODS,
  SERVER_NOTIFICATION_METHODS,
} from "./index";

const expectedRequests = [
  "helm/list",
  "helm/save",
  "project/list",
  "project/list_files",
  "project/save",
  "workspace/list",
  "workspace/save",
  "workspace/git/list_branches",
  "workspace/git/create_branch",
  "agent/list",
  "agent/test",
  "agent/get_model_options",
  "agent/save",
  "session/new",
  "session/list",
  "session/list_messages",
  "session/get_artifacts",
  "session/check_resume",
  "session/resume",
  "session/prompt",
  "session/set_config_option",
  "session/rename",
  "session/cleanup",
  "permission/respond",
  "device/list",
  "device/revoke",
  "device/pair",
  "device/authenticate",
];

test("METHODS contains every request and notification method", () => {
  for (const name of expectedRequests) {
    assert.ok(METHODS[name], `missing request descriptor: ${name}`);
    assert.equal(METHODS[name].kind, "request", `wrong kind: ${name}`);
  }
  assert.equal(METHODS["session/cancel"].kind, "notification");
  assert.equal(METHODS["session/update"].kind, "notification");
  assert.equal(METHODS["error/raised"].kind, "notification");
});

test("method name lists are exhaustive and stable", () => {
  assert.deepEqual([...CLIENT_REQUEST_METHODS], expectedRequests);
  assert.deepEqual([...CLIENT_NOTIFICATION_METHODS], ["session/cancel"]);
  assert.deepEqual([...SERVER_NOTIFICATION_METHODS], ["session/update", "error/raised"]);
});
