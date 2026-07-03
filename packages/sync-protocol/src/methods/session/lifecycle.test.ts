import assert from "node:assert/strict";
import test from "node:test";
import * as sessionDraft from "./draft";
import * as sessionDiscardDraft from "./discard-draft";
import * as sessionNew from "./new";
import * as sessionList from "./list";
import * as sessionListTimeline from "./list-timeline";
import * as sessionGetArtifacts from "./get-artifacts";
import * as sessionCheckResume from "./check-resume";
import * as sessionResume from "./resume";
import * as sessionPrompt from "./prompt";
import * as sessionUpdateQueuedPrompt from "./update-queued-prompt";
import * as sessionDeleteQueuedPrompt from "./delete-queued-prompt";
import * as sessionConfigure from "./configure";
import * as sessionSetConfigOption from "./set-config-option";
import * as sessionRename from "./rename";
import * as sessionCleanup from "./cleanup";
import * as debugReimportHistory from "../debug/reimport-history";

test("session/new requires project cwd and agent", () => {
  assert.equal(sessionNew.method, "session/new");
  sessionNew.ParamsSchema.parse({ projectId: "p1", cwd: "D:/repo", agentId: "a1" });
});

test("session/draft returns runtime draft metadata", () => {
  assert.equal(sessionDraft.method, "session/draft");
  sessionDraft.ParamsSchema.parse({
    deckClientId: "deck-1",
    projectId: "p1",
    cwd: "D:/repo",
    agentId: "a1",
  });
  const result = sessionDraft.ResultSchema.parse({
    ok: true,
    draftId: "draft-1",
    deckClientId: "deck-1",
    cwd: "D:/repo",
    scopeKey: "deck-1:p1:ws1:a1",
    logicalScopeKey: "p1:ws1:a1",
    runtimeSessionId: "runtime-1",
    state: { model: "gpt-5.5" },
    modelOptions: [{ id: "gpt-5.5", name: "GPT 5.5" }],
    configOptions: [],
    availableCommands: [{ name: "init" }],
    createdAt: "2026-05-12T00:00:00.000Z",
    expiresAt: "2026-05-12T00:10:00.000Z",
    reused: false,
    message: "ACP runtime draft ready.",
  });
  assert.deepEqual(result.availableCommands, [{ name: "init" }]);
});

test("session/discard_draft supports draft cleanup reasons", () => {
  assert.equal(sessionDiscardDraft.method, "session/discard_draft");
  sessionDiscardDraft.ParamsSchema.parse({
    deckClientId: "deck-1",
    draftId: "draft-1",
    reason: "scope-change",
  });
  sessionDiscardDraft.ResultSchema.parse({
    ok: true,
    discarded: true,
    draftId: "draft-1",
    message: "Draft discarded.",
  });
});

test("session/list returns paginated session summaries", () => {
  assert.equal(sessionList.method, "session/list");
  sessionList.ResultSchema.parse({ sessions: [] });
});

test("session/list_timeline returns paginated canonical timeline entries", () => {
  assert.equal(sessionListTimeline.method, "session/list_timeline");
  assert.throws(() => sessionListTimeline.ParamsSchema.parse({}));
  sessionListTimeline.ParamsSchema.parse({ sessionId: "s1" });
  sessionListTimeline.ParamsSchema.parse({ sessionId: "s1", limit: 20, before: "order\t5\tentry-5" });
  const result = sessionListTimeline.ResultSchema.parse({
    sessionId: "s1",
    before: "order\t5\tentry-5",
    entries: [
      {
        id: "assistant-1",
        kind: "assistant_message",
        chunks: [],
        timestamp: "2026-06-29T10:00:01.000Z",
        updatedAt: "2026-06-29T10:00:01.000Z",
        sequence: 1,
      },
    ],
    nextCursor: "order\t1\tassistant-1",
    hasMore: true,
    liveState: {
      promptQueue: {
        sessionId: "s1",
        queued: [],
      },
    },
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.liveState?.promptQueue?.sessionId, "s1");
});

test("session/get_artifacts returns outputs/diffs/toolCalls arrays", () => {
  assert.equal(sessionGetArtifacts.method, "session/get_artifacts");
  const parsed = sessionGetArtifacts.ResultSchema.parse({
    sessionId: "s1",
    outputs: [],
    diffs: [],
    toolCalls: [],
  });
  assert.deepEqual(parsed.toolCalls, []);
});

test("session/check_resume and session/resume share sessionId param", () => {
  assert.equal(sessionCheckResume.method, "session/check_resume");
  assert.equal(sessionResume.method, "session/resume");
});

test("session/prompt accepts either sessionId or draftId", () => {
  assert.equal(sessionPrompt.method, "session/prompt");
  sessionPrompt.ParamsSchema.parse({ sessionId: "s1", text: "hello" });
  sessionPrompt.ParamsSchema.parse({ draftId: "d1", text: "hello" });
  assert.throws(() => sessionPrompt.ParamsSchema.parse({ text: "hello" }));
  assert.throws(() =>
    sessionPrompt.ParamsSchema.parse({ sessionId: "s1", draftId: "d1", text: "hello" }),
  );
  sessionPrompt.ResultSchema.parse({ accepted: "sent", stopReason: "end_turn", session: { id: "s1" } });
});

test("session/prompt result can report queued acceptance", () => {
  assert.equal(sessionPrompt.method, "session/prompt");
  const parsed = sessionPrompt.ResultSchema.parse({
    accepted: "queued",
    queueItem: {
      id: "queue-1",
      sessionId: "session-1",
      text: "next",
      clientMessageId: "client-1",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      status: "queued",
    },
  });
  assert.equal(parsed.accepted, "queued");
});

test("queued prompt edit and delete methods use sessionId and queueItemId", () => {
  assert.equal(sessionUpdateQueuedPrompt.method, "session/update_queued_prompt");
  assert.equal(sessionDeleteQueuedPrompt.method, "session/delete_queued_prompt");
  assert.equal(
    sessionUpdateQueuedPrompt.ParamsSchema.parse({
      sessionId: "session-1",
      queueItemId: "queue-1",
      text: "edited",
    }).text,
    "edited",
  );
  assert.equal(
    sessionDeleteQueuedPrompt.ParamsSchema.parse({
      sessionId: "session-1",
      queueItemId: "queue-1",
    }).queueItemId,
    "queue-1",
  );
});

test("session/configure allows partial active or draft config", () => {
  assert.equal(sessionConfigure.method, "session/configure");
  sessionConfigure.ParamsSchema.parse({ sessionId: "s1" });
  sessionConfigure.ParamsSchema.parse({ draftId: "d1", model: "gpt-5.5" });
  assert.throws(() => sessionConfigure.ParamsSchema.parse({}));
  assert.throws(() =>
    sessionConfigure.ParamsSchema.parse({ sessionId: "s1", draftId: "d1" }),
  );
});

test("session/set_config_option remains a compatibility alias", () => {
  assert.equal(sessionSetConfigOption.method, "session/set_config_option");
  assert.equal(sessionSetConfigOption.ParamsSchema, sessionConfigure.ParamsSchema);
  assert.equal(sessionSetConfigOption.ResultSchema, sessionConfigure.ResultSchema);
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

test("debug/reimport_history requires session id and returns replacement history", () => {
  assert.equal(debugReimportHistory.method, "debug/reimport_history");
  debugReimportHistory.ParamsSchema.parse({ sessionId: "s1", limit: 50 });
  assert.throws(() => debugReimportHistory.ParamsSchema.parse({}));
  debugReimportHistory.ResultSchema.parse({
    sessionId: "s1",
    messages: [],
    outputs: [],
    diffs: [],
    toolCalls: [],
    hasMore: false,
    activityHasMore: false,
    message: "History reimported.",
  });
});
