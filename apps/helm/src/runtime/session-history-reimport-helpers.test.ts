import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import {
  chooseRecoverySummary,
  recoverUserPromptFromSessionSummary,
} from "./session-history-reimport-helpers.js";

function sessionSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "session-1",
    title: "Active title",
    status: "idle",
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

test("chooseRecoverySummary prefers stored text when active summary has no recoverable text", () => {
  const active = sessionSummary({ title: "", lastMessagePreview: "" });
  const stored = sessionSummary({ title: "Stored title", lastMessagePreview: "Stored prompt" });

  assert.equal(chooseRecoverySummary(active, stored), stored);
});

test("recoverUserPromptFromSessionSummary inserts a prompt before provider messages", () => {
  let messages: AgentMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      text: "answer",
      timestamp: "2026-05-28T00:00:10.000Z",
    },
  ];
  const store = {
    list: () => messages,
    replace: (_sessionId: string, next: AgentMessage[]) => {
      messages = next;
    },
  };

  recoverUserPromptFromSessionSummary({
    sessionId: "session-1",
    summary: sessionSummary({ lastMessagePreview: "Original prompt" }),
    sessionMessageStore: store,
  });

  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[0]?.text, "Original prompt");
  assert.equal(messages[0]?.timestamp, "2026-05-28T00:00:09.999Z");
});
