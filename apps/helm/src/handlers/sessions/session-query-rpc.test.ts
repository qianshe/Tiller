import assert from "node:assert/strict";
import test from "node:test";
import { resumeSession } from "./session-query-rpc.js";

test("resumeSession broadcasts refreshed session_updated from the resume result payload", async () => {
  const notifications: Array<{ method: string; params: any }> = [];
  const refreshedSession = {
    id: "s1",
    title: "Session 1",
    projectId: "p1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "main",
    agentId: "claude-code",
    agentName: "Claude Code",
    status: "idle",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:01.000Z",
    messageCount: 3,
    runtimeSessionId: "runtime-new",
    model: "claude-sonnet-new",
    modelOptions: [{ id: "claude-sonnet-new", name: "Claude Sonnet New" }],
  };

  const result = await resumeSession(
    { sessionId: "s1" },
    {
      startSessionResume: async () => ({
        ok: true,
        resume: {
          mode: "same-process",
          state: "resume-available",
          reason: "resume",
          checkedAt: "2026-07-06T00:00:00.000Z",
          runtimeSessionId: "runtime-new",
          restoreMethod: "session/resume",
        },
        session: refreshedSession,
        message: "已恢复",
      }),
      promptQueue: {
        snapshot: () => ({ queued: [], inFlight: false }),
      },
      broadcastNotification: (method: string, params: any) => {
        notifications.push({ method, params });
      },
      broadcastSessionTopic: () => undefined,
      logDebug: () => undefined,
      logInfo: () => undefined,
    } as any,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(notifications, [
    {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { kind: "session_updated", session: refreshedSession },
      },
    },
  ]);
});
