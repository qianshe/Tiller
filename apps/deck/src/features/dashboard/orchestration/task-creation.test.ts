import assert from "node:assert/strict";
import test from "node:test";
import {
  DashboardTaskLaunchError,
  launchDashboardTask,
} from "./task-creation.js";

test("dashboard task creation sends the prompt after the session is created", async () => {
  const requests: Array<{ method: string; params: unknown }> = [];

  const sessionId = await launchDashboardTask({
    projectId: "project-1",
    cwd: "D:/repo/.worktrees/dashboard",
    agentId: "codex",
    prompt: "修复 Dashboard",
    dispatch: async (method, params) => {
      requests.push({ method, params });
      return method === "session/new" ? { session: { id: "session-1" } } : {};
    },
  });

  assert.equal(sessionId, "session-1");
  assert.deepEqual(requests, [
    {
      method: "session/new",
      params: {
        projectId: "project-1",
        cwd: "D:/repo/.worktrees/dashboard",
        agentId: "codex",
      },
    },
    {
      method: "session/prompt",
      params: {
        sessionId: "session-1",
        text: "修复 Dashboard",
        content: [{ type: "text", text: "修复 Dashboard" }],
      },
    },
  ]);
});

test("dashboard task creation can send a prompt to an existing idle session", async () => {
  const requests: Array<{ method: string; params: unknown }> = [];

  const sessionId = await launchDashboardTask({
    sessionId: "session-idle",
    prompt: "继续处理 Dashboard",
    dispatch: async (method, params) => {
      requests.push({ method, params });
      return {};
    },
  });

  assert.equal(sessionId, "session-idle");
  assert.deepEqual(requests, [
    {
      method: "session/prompt",
      params: {
        sessionId: "session-idle",
        text: "继续处理 Dashboard",
        content: [{ type: "text", text: "继续处理 Dashboard" }],
      },
    },
  ]);
});

test("dashboard task creation reports which launch phase failed", async () => {
  await assert.rejects(
    launchDashboardTask({
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: "codex",
      prompt: "修复 Dashboard",
      dispatch: async (method) => {
        if (method === "session/new") {
          return { session: { id: "session-1" } };
        }
        throw new Error("prompt failed");
      },
    }),
    (error) =>
      error instanceof DashboardTaskLaunchError &&
      error.phase === "session/prompt" &&
      error.cause instanceof Error &&
      error.cause.message === "prompt failed",
  );
});
