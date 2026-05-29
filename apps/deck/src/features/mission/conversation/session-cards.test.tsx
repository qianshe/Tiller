import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionSummary } from "@tiller/shared";
import {
  DraftSessionCard,
  SessionCard,
  SessionPreviewMessages,
  SessionRestoreNotice,
  type MissionDraftChatWindow,
} from "./session-cards.js";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    title: "Build feature",
    agentId: "codex",
    agentName: "Codex",
    projectId: "project-1",
    projectName: "Tiller",
    cwd: "D:/myProject/tools/Tiller",
    status: "running",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:01:00.000Z",
    ...overrides,
  } as SessionSummary;
}

test("SessionPreviewMessages renders session preview and restoring state", () => {
  const html = renderToStaticMarkup(
    <SessionPreviewMessages session={session()} restoring />,
  );

  assert.match(html, /Build feature/);
  assert.match(html, /Codex/);
  assert.match(html, /restoring/);
});

test("SessionRestoreNotice renders restore title and message", () => {
  const html = renderToStaticMarkup(
    <SessionRestoreNotice notice={{ title: "恢复中", message: "正在重连 ACP" }} />,
  );

  assert.match(html, /恢复中/);
  assert.match(html, /正在重连 ACP/);
});

test("DraftSessionCard renders selectable agent options", () => {
  const draftWindow: MissionDraftChatWindow = {
    id: "draft-1",
    title: "新任务",
    projectName: "Tiller",
    worktreeName: "feature/0.1.6",
    agentName: null,
    status: "select-agent",
    message: "请选择一个 ACP Agent。",
  };

  const html = renderToStaticMarkup(
    <DraftSessionCard
      draftWindow={draftWindow}
      active={false}
      agentOptions={[{ id: "codex", name: "Codex" }]}
    />,
  );

  assert.match(html, /选择 ACP Agent/);
  assert.match(html, /Codex/);
});

test("SessionCard renders running tool status in the title bar", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session()}
      active
      toolLoading={{
        activity: { title: "Tool: find -type d" },
        pendingToolPresent: true,
      }}
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.match(html, /mission-tool-loading-title/);
  assert.match(html, /正在执行工具/);
  assert.match(html, /等待 find -type d 返回结果…/);
});
