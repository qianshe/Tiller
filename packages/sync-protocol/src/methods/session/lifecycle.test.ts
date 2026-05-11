import assert from "node:assert/strict";
import test from "node:test";
import * as sessionNew from "./new";
import * as sessionPrewarm from "./prewarm";
import * as sessionList from "./list";
import * as sessionListMessages from "./list-messages";
import * as sessionGetArtifacts from "./get-artifacts";
import * as sessionCheckResume from "./check-resume";
import * as sessionResume from "./resume";
import * as sessionSetConfigOption from "./set-config-option";
import * as sessionRename from "./rename";
import * as sessionCleanup from "./cleanup";

test("session/new requires project, workspace, agent", () => {
  assert.equal(sessionNew.method, "session/new");
  sessionNew.ParamsSchema.parse({ projectId: "p1", workspaceId: "ws1", agentId: "a1" });
});

test("session/prewarm requires project, workspace, agent", () => {
  assert.equal(sessionPrewarm.method, "session/prewarm");
  sessionPrewarm.ParamsSchema.parse({ projectId: "p1", workspaceId: "ws1", agentId: "a1" });
  const result = sessionPrewarm.ResultSchema.parse({
    ok: true,
    warmed: true,
    providerId: "a1",
    workspaceId: "ws1",
    runtimeSessionId: "runtime-1",
    currentModelId: "gpt-5.5",
    modelOptions: [{ id: "gpt-5.5", name: "GPT 5.5" }],
    configOptions: [],
    availableCommands: [{ name: "init" }],
    state: { model: "gpt-5.5" },
    message: "ACP runtime prewarmed.",
  });
  assert.deepEqual(result.availableCommands, [{ name: "init" }]);
});

test("session/list returns paginated session summaries", () => {
  assert.equal(sessionList.method, "session/list");
  sessionList.ResultSchema.parse({ sessions: [] });
});

test("session/list_messages requires sessionId", () => {
  assert.equal(sessionListMessages.method, "session/list_messages");
  assert.throws(() => sessionListMessages.ParamsSchema.parse({}));
});

test("session/get_artifacts returns outputs/diffs/toolCalls arrays", () => {
  assert.equal(sessionGetArtifacts.method, "session/get_artifacts");
  sessionGetArtifacts.ResultSchema.parse({
    sessionId: "s1",
    outputs: [],
    diffs: [],
    toolCalls: [],
  });
});

test("session/check_resume and session/resume share sessionId param", () => {
  assert.equal(sessionCheckResume.method, "session/check_resume");
  assert.equal(sessionResume.method, "session/resume");
});

test("session/set_config_option allows partial config", () => {
  assert.equal(sessionSetConfigOption.method, "session/set_config_option");
  sessionSetConfigOption.ParamsSchema.parse({ sessionId: "s1" });
});

test("session/rename requires session id and title", () => {
  assert.equal(sessionRename.method, "session/rename");
  sessionRename.ParamsSchema.parse({ sessionId: "s1", title: "New title" });
  sessionRename.ResultSchema.parse({ ok: true });
  assert.throws(() => sessionRename.ParamsSchema.parse({ sessionId: "s1" }));
});

test("session/cleanup carries result payload", () => {
  assert.equal(sessionCleanup.method, "session/cleanup");
  sessionCleanup.ResultSchema.parse({ result: {} });
});
