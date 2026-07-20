import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_API_ERROR_CODE,
  createClaudeApiErrorMessageProjector,
  isClaudeApiErrorMessageInTranscript,
} from "./api-error-message";

const current403 = "Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度: ＄0.103684, 需要预扣费额度: ＄1.165416 (request id: 202607200848103806434008268d9d68IxhwXdM)";

test("Claude API-error projector maps transcript-marked synthetic errors", () => {
  const lookups: unknown[] = [];
  const projector = createClaudeApiErrorMessageProjector((input) => {
    lookups.push(input);
    return input.messageId === "synthetic-error";
  });

  assert.deepEqual(
    projector.mapUpdate({
      sessionId: "runtime-1",
      cwd: "D:/repo",
      updateType: "agent_message_chunk",
      update: { messageId: "synthetic-error" },
      text: "Prompt is too long",
    }),
    {
      type: "error",
      code: CLAUDE_API_ERROR_CODE,
      message: "Prompt is too long",
    },
  );
  assert.deepEqual(lookups, [{
    runtimeSessionId: "runtime-1",
    cwd: "D:/repo",
    messageId: "synthetic-error",
  }]);
  assert.equal(
    projector.mapUpdate({
      sessionId: "runtime-1",
      cwd: "D:/repo",
      updateType: "agent_message_chunk",
      update: { messageId: "ordinary-message" },
      text: "普通 assistant 回复",
    }),
    null,
  );
  assert.equal(lookups.length, 1);
});

test("Claude API-error projector maps the current authentication failure before transcript persistence", () => {
  const projector = createClaudeApiErrorMessageProjector(() => false);

  assert.deepEqual(
    projector.mapUpdate({
      sessionId: "runtime-1",
      updateType: "agent_message_chunk",
      update: { messageId: "synthetic-error" },
      text: current403,
    }),
    {
      type: "error",
      code: CLAUDE_API_ERROR_CODE,
      message: current403,
    },
  );
  assert.equal(
    projector.mapUpdate({
      sessionId: "runtime-1",
      updateType: "agent_message_chunk",
      update: { messageId: "assistant-message" },
      text: `我遇到了：${current403}`,
    }),
    null,
  );
});

test("Claude transcript API-error detection requires the matching synthetic assistant message", () => {
  const transcript = [
    JSON.stringify({
      type: "assistant",
      isApiErrorMessage: true,
      message: { id: "synthetic-error", role: "assistant", content: [{ type: "text", text: current403 }] },
    }),
    JSON.stringify({
      type: "assistant",
      isApiErrorMessage: false,
      message: { id: "ordinary-message", role: "assistant", content: [{ type: "text", text: current403 }] },
    }),
  ].join("\n");

  assert.equal(isClaudeApiErrorMessageInTranscript(transcript, "synthetic-error"), true);
  assert.equal(isClaudeApiErrorMessageInTranscript(transcript, "ordinary-message"), false);
  assert.equal(isClaudeApiErrorMessageInTranscript(transcript, "missing"), false);
});
