import assert from "node:assert/strict";
import test from "node:test";
import * as sessionPrompt from "./session/prompt";
import * as sessionCancel from "./session/cancel";
import * as sessionSubscribe from "./session/subscribe";
import * as sessionUnsubscribe from "./session/unsubscribe";
import * as sessionUpdate from "./session/update";
import * as errorRaised from "./error/raised";
import * as devicePair from "./device/pair";
import * as deviceAuthenticate from "./device/authenticate";

test("session/prompt result has stopReason", () => {
  assert.equal(sessionPrompt.method, "session/prompt");
  assert.deepEqual(
    sessionPrompt.ResultSchema.parse({ accepted: "sent", stopReason: "end_turn" }),
    { accepted: "sent", stopReason: "end_turn" },
  );
});

test("session/cancel is a notification", () => {
  assert.equal(sessionCancel.method, "session/cancel");
  assert.equal(sessionCancel.descriptor.kind, "notification");
});

test("session topic subscription methods validate session ids", () => {
  assert.equal(sessionSubscribe.method, "session/subscribe");
  assert.equal(sessionUnsubscribe.method, "session/unsubscribe");
  assert.deepEqual(sessionSubscribe.ParamsSchema.parse({ sessionId: "session-1" }), {
    sessionId: "session-1",
  });
  assert.deepEqual(sessionUnsubscribe.ParamsSchema.parse({ sessionId: "session-1" }), {
    sessionId: "session-1",
  });
  assert.deepEqual(sessionSubscribe.ResultSchema.parse({ ok: true, message: "Subscribed to session session-1." }), {
    ok: true,
    message: "Subscribed to session session-1.",
  });
});

test("session/update accepts every kind", () => {
  assert.equal(sessionUpdate.method, "session/update");
  for (const kind of [
    "agent_message",
    "tool_call",
    "command_output",
    "diff_update",
    "status_change",
    "config_options",
    "model_options",
    "commands_available",
    "session_updated",
    "prompt_queue",
    "plan_update",
    "user_message",
    "permission_request",
    "permission_resolved",
  ]) {
    sessionUpdate.ParamsSchema.parse({
      sessionId: "s1",
      update: kind === "command_output"
        ? { kind, commandId: "c1", chunk: {} }
        : kind === "permission_resolved"
          ? { kind, permissionRequestId: "pr1", decision: {} }
          : kind === "diff_update"
            ? { kind, files: [] }
            : kind === "config_options"
              ? { kind, state: {}, options: [] }
              : kind === "model_options"
                ? { kind, options: [] }
                : kind === "commands_available"
                  ? { kind, commands: [] }
                  : kind === "session_updated"
                    ? { kind, session: {} }
                    : kind === "prompt_queue"
                      ? { kind, queue: { sessionId: "s1", queued: [] } }
                      : kind === "plan_update"
                        ? { kind, plan: { entries: [], updatedAt: "2026-06-02T00:00:00.000Z" } }
                        : kind === "user_message"
                          ? { kind, message: { id: "m1", role: "user", text: "hello", timestamp: "2026-05-15T00:00:00.000Z" } }
                          : kind === "agent_message"
                            ? { kind, message: {} }
                            : kind === "tool_call"
                              ? { kind, toolCall: {} }
                              : kind === "permission_request"
                                ? { kind, permissionRequest: {} }
                                : { kind, status: "running" },
    });
  }
});

test("session/update agent_message preserves streaming state", () => {
  const parsed = sessionUpdate.ParamsSchema.parse({
    sessionId: "s1",
    update: { kind: "agent_message", message: {}, streaming: true },
  });

  assert.equal(
    (parsed.update as Extract<typeof parsed.update, { kind: "agent_message" }>).streaming,
    true,
  );
});

test("error/raised is a notification with at least a message", () => {
  assert.equal(errorRaised.method, "error/raised");
  assert.equal(errorRaised.descriptor.kind, "notification");
  errorRaised.ParamsSchema.parse({ message: "boom" });
});

test("device/pair and device/authenticate carry the expected fields", () => {
  assert.equal(devicePair.method, "device/pair");
  assert.equal(deviceAuthenticate.method, "device/authenticate");
  devicePair.ResultSchema.parse({ ok: true, message: "paired" });
  deviceAuthenticate.ResultSchema.parse({ ok: true, message: "ok" });
});
