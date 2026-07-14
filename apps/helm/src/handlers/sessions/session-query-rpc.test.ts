import assert from "node:assert/strict";
import test from "node:test";
import { checkResume, resumeSession } from "./session-query-rpc.js";

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

test("legacy evidence sessions are display-only and never resume ACP", async () => {
  const sessionId = "legacy-session";
  let resumeCalls = 0;
  const context = {
    sessionStore: {
      get: (id: string) => id === sessionId ? { id: sessionId, agentId: "codex" } : undefined,
    },
    sessionLegacyEvidenceStore: {
      describe: () => ({
        sessionId,
        available: true,
        counts: { message: 2, tool_call: 1, output: 3 },
      }),
    },
    hydrateSessionSummary: (summary: any) => ({
      ...summary,
      resume: {
        mode: "reconnect",
        state: "resume-available",
        reason: "stale runtime metadata",
        checkedAt: "2026-07-11T00:00:00.000Z",
        restoreMethod: "session/load",
      },
    }),
    buildResumeInfo: () => {
      throw new Error("legacy evidence must bypass resume discovery");
    },
    getAgents: () => [],
    resolveProviderById: () => undefined,
    startSessionResume: async () => {
      resumeCalls += 1;
      throw new Error("legacy evidence must never start ACP resume");
    },
    logDebug: () => undefined,
    logInfo: () => undefined,
  } as any;

  const checked = checkResume({ sessionId }, context);
  assert.deepEqual(checked.resume, {
    mode: "none",
    state: "history-only",
    reason: "Legacy session evidence is display-only.",
    checkedAt: "2026-07-11T00:00:00.000Z",
    restoreMethod: "ui-history",
  });

  const result = await resumeSession({ sessionId }, context);

  assert.equal(result.ok, false);
  assert.equal(result.resume.state, "history-only");
  assert.equal(result.resume.restoreMethod, "ui-history");
  assert.equal(resumeCalls, 0);
});
