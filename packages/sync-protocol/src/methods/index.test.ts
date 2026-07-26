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
  "logging/get",
  "logging/save",
  "project/list",
  "project/list_directories",
  "project/list_files",
  "project/list_worktrees",
  "project/git/list_branches",
  "project/git/create_worktree",
  "project/git/status",
  "project/git/commit",
  "project/git/discard",
  "project/git/push",
  "project/git/pull",
  "project/git/graph",
  "project/git/commit_detail",
  "project/git/file_diff",
  "project/save",
  "project/delete",
  "agent/list",
  "agent/test",
  "agent/connections",
  "agent/connect",
  "agent/reconnect",
  "agent/save",
  "agent/delete",
  "session/new",
  "session/draft",
  "session/discard_draft",
  "session/list",
  "session/list_timeline",
  "session/repair_timeline",
  "session/list_legacy_evidence",
  "session/get_artifacts",
  "session/get_subagent_detail",
  "session/check_resume",
  "session/resume",
  "session/prompt",
  "session/update_queued_prompt",
  "session/delete_queued_prompt",
  "session/subscribe",
  "session/unsubscribe",
  "session/configure",
  "session/set_config_option",
  "session/rename",
  "session/cleanup",
  "permission/list_pending",
  "permission/respond",
  "approval/list_pending",
  "approval/list",
  "approval/clear_history",
  "approval/respond",
  "device/list",
  "device/revoke",
  "device/pair",
  "device/authenticate",
  "daemon/shutdown",
];

test("METHODS contains every request and notification method", () => {
  for (const name of expectedRequests) {
    assert.ok(METHODS[name], `missing request descriptor: ${name}`);
    assert.equal(METHODS[name].kind, "request", `wrong kind: ${name}`);
  }
  assert.equal(METHODS["session/cancel"].kind, "notification");
  assert.equal(METHODS["session/update"].kind, "notification");
  assert.equal(METHODS["error/raised"].kind, "notification");
  assert.equal(METHODS["notification/raised"].kind, "notification");
  assert.equal(METHODS["approval/created"].kind, "notification");
  assert.equal(METHODS["approval/resolved"].kind, "notification");
});

test("method name lists are exhaustive and stable", () => {
  assert.deepEqual([...CLIENT_REQUEST_METHODS], expectedRequests);
  assert.deepEqual([...CLIENT_NOTIFICATION_METHODS], ["session/cancel"]);
  assert.deepEqual(
    [...SERVER_NOTIFICATION_METHODS],
    ["session/update", "error/raised", "notification/raised", "approval/created", "approval/resolved"],
  );
});
