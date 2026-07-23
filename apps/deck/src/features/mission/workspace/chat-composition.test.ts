import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComposerPromptPlaceholder,
  buildDraftPreparingMessage,
  buildMissionChatRestoreNotice,
  resolveMissionChatSelectedSessionId,
} from "./chat-composition.js";

test("resolveMissionChatSelectedSessionId hides real selection while draft window is focused", () => {
  assert.equal(
    resolveMissionChatSelectedSessionId({
      focusedDraftWindow: true,
      focusedRealSessionId: "session-2",
      activeSessionId: "session-1",
    }),
    null,
  );
  assert.equal(
    resolveMissionChatSelectedSessionId({
      focusedDraftWindow: false,
      focusedRealSessionId: "session-2",
      activeSessionId: "session-1",
    }),
    "session-2",
  );
});

test("buildMissionChatRestoreNotice maps restore gate states to user-facing notice", () => {
  assert.deepEqual(
    buildMissionChatRestoreNotice({
      show: true,
      state: "history-only",
      message: "只能查看历史",
    }),
    { title: "ACP 会话未恢复", message: "只能查看历史" },
  );
  assert.deepEqual(
    buildMissionChatRestoreNotice({
      show: true,
      state: "restoring",
      message: "正在重连",
    }),
    { title: "正在恢复 ACP", message: "正在重连" },
  );
  assert.equal(
    buildMissionChatRestoreNotice({ show: false, state: "restoring", message: "ignored" }),
    undefined,
  );
});

test("buildComposerPromptPlaceholder hides restore failure details from the input", () => {
  assert.equal(
    buildComposerPromptPlaceholder({
      showRestoreNotice: true,
      state: "failed",
      message: "ACP connection closed: provider config error",
      isMobile: false,
      draftPromptPlaceholder: "输入消息",
    }),
    "输入消息",
  );
  assert.equal(
    buildComposerPromptPlaceholder({
      showRestoreNotice: true,
      state: "restoring",
      message: "正在恢复 ACP 会话，恢复成功后即可继续对话。",
      isMobile: false,
      draftPromptPlaceholder: "输入消息",
    }),
    "正在恢复 ACP 会话，恢复成功后即可继续对话。",
  );
});

test("buildDraftPreparingMessage uses agent and connection fallbacks", () => {
  assert.equal(
    buildDraftPreparingMessage({ agentName: "Codex", connectionMessage: "连接中" }),
    "Codex 连接中",
  );
  assert.equal(
    buildDraftPreparingMessage({ agentName: null, connectionMessage: null }),
    "ACP Agent 正在启动连接，连接成功后将显示输入框。",
  );
});
