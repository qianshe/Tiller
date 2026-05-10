import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, WorkspaceSummary } from "@tiller/shared";
import { resolveAcpConnectionKey } from "./connection-key";
import { createAcpConnectionManager } from "./connection-manager";

const provider: AcpAgentProvider = {
  id: "codex",
  name: "Codex",
  command: "codex-acp",
  args: ["--stdio"],
  env: { SAFE_PUBLIC_FLAG: "1" },
  cwd: "D:/agents/codex",
  transport: "stdio",
  protocol: "acp",
};

const workspace: WorkspaceSummary = {
  id: "workspace-1",
  name: "Tiller",
  path: "D:/myProject/tools/Tiller",
};

test("connection key ignores workspace and session config but includes launch identity", () => {
  const first = resolveAcpConnectionKey({
    provider,
    workspace,
    sessionConfig: { model: "gpt-5.5", reasoningEffort: "high" },
  });
  const second = resolveAcpConnectionKey({
    provider,
    workspace: { ...workspace, id: "workspace-2", path: "D:/other" },
    sessionConfig: { model: "gpt-5.4", reasoningEffort: "low" },
  });

  assert.equal(first, second);
});

test("connection key changes when provider launch identity changes", () => {
  const base = resolveAcpConnectionKey({ provider, workspace });
  const differentCommand = resolveAcpConnectionKey({
    provider: { ...provider, command: "opencode", args: ["acp"] },
    workspace,
  });
  const differentEnv = resolveAcpConnectionKey({
    provider: { ...provider, env: { SAFE_PUBLIC_FLAG: "2" } },
    workspace,
  });

  assert.notEqual(base, differentCommand);
  assert.notEqual(base, differentEnv);
});

test("connection manager reuses an in-flight connection open", async () => {
  let openCount = 0;
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, workspace }),
          providerId: provider.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          launchCwd: workspace.path,
          status: "ready" as const,
          runtimeConnectionId: "conn-1",
          initialized: true,
          activeSessionCount: 0,
          pendingSessionCount: 0,
          sessions: [],
          capabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
        }),
        dispose: async () => undefined,
        openOrCreateSession: async () => ({
          runtimeSessionId: "runtime-session-1",
          sessionCapabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
          sessionConfigState: {},
          sessionConfigOptions: [],
          sessionModelState: undefined,
          prompt: async () => undefined,
          configure: async () => ({ runtimeApplied: false, state: {}, modelState: undefined }),
          respondPermission: () => undefined,
          deleteSession: async () => ({ kind: "unsupported", providerId: provider.id, message: "unsupported" }),
          close: async () => ({ kind: "remote-closed", providerId: provider.id, message: "closed" }),
          cancel: () => undefined,
          supportsPermissionResponses: true,
        }),
      };
    },
  });

  const [first, second] = await Promise.all([
    manager.openConnection({ provider, workspace }),
    manager.openConnection({ provider, workspace }),
  ]);

  assert.equal(openCount, 1);
  assert.equal(first, second);
  assert.equal(manager.listInventory().length, 1);
});

test("connection manager reuses one provider connection across session workspaces", async () => {
  let openCount = 0;
  const receivedWorkspaces: string[] = [];
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, workspace }),
          providerId: provider.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          launchCwd: provider.cwd ?? workspace.path,
          status: "ready" as const,
          runtimeConnectionId: "conn-1",
          initialized: true,
          activeSessionCount: 0,
          pendingSessionCount: 0,
          sessions: [],
          capabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
        }),
        dispose: async () => undefined,
        openOrCreateSession: async (request) => {
          receivedWorkspaces.push(request.workspace.path);
          return {
            runtimeSessionId: "runtime-session-1",
            sessionCapabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
            sessionConfigState: {},
            sessionConfigOptions: [],
            sessionModelState: undefined,
            prompt: async () => undefined,
            configure: async () => ({ runtimeApplied: false, state: {}, modelState: undefined }),
            respondPermission: () => undefined,
            deleteSession: async () => ({ kind: "unsupported", providerId: provider.id, message: "unsupported" }),
            close: async () => ({ kind: "remote-closed", providerId: provider.id, message: "closed" }),
            cancel: () => undefined,
            supportsPermissionResponses: true,
          };
        },
      };
    },
  });

  await manager.openSession({ provider, workspace, sessionId: "session-1", onEvent: () => undefined });
  await manager.openSession({
    provider,
    workspace: { ...workspace, id: "workspace-2", path: "D:/other" },
    sessionId: "session-2",
    onEvent: () => undefined,
  });

  assert.equal(openCount, 1);
  assert.deepEqual(receivedWorkspaces, [workspace.path, "D:/other"]);
});

test("connection manager replaces a closed cached connection", async () => {
  let openCount = 0;
  let status: "ready" | "closed" = "ready";
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      status = "ready";
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, workspace }),
          providerId: provider.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          launchCwd: workspace.path,
          status,
          runtimeConnectionId: `conn-${openCount}`,
          initialized: true,
          activeSessionCount: 0,
          pendingSessionCount: 0,
          sessions: [],
          capabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
        }),
        dispose: async () => { status = "closed"; },
        openOrCreateSession: async () => ({
          runtimeSessionId: "runtime-session-1",
          sessionCapabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
          sessionConfigState: {},
          sessionConfigOptions: [],
          sessionModelState: undefined,
          prompt: async () => undefined,
          configure: async () => ({ runtimeApplied: false, state: {}, modelState: undefined }),
          respondPermission: () => undefined,
          deleteSession: async () => ({ kind: "unsupported", providerId: provider.id, message: "unsupported" }),
          close: async () => ({ kind: "remote-closed", providerId: provider.id, message: "closed" }),
          cancel: () => undefined,
          supportsPermissionResponses: true,
        }),
      };
    },
  });

  const first = await manager.openConnection({ provider, workspace });
  await first.dispose();
  const second = await manager.openConnection({ provider, workspace });

  assert.equal(openCount, 2);
  assert.notEqual(first, second);
});

test("connection manager reconnect disposes cached connection before opening a new one", async () => {
  let openCount = 0;
  let disposeCount = 0;
  const lifecycleEvents: string[] = [];
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      const runtimeConnectionId = `conn-${openCount}`;
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, workspace }),
          providerId: provider.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          launchCwd: workspace.path,
          status: "ready" as const,
          runtimeConnectionId,
          initialized: true,
          activeSessionCount: 0,
          pendingSessionCount: 0,
          sessions: [],
          capabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
        }),
        dispose: async () => {
          disposeCount += 1;
        },
        openOrCreateSession: async () => {
          throw new Error("reconnect should not create sessions");
        },
      };
    },
  });

  const first = await manager.openConnection({ provider, workspace });
  const second = await manager.reconnect({
    provider,
    workspace,
    onLifecycleEvent: (event) => lifecycleEvents.push(event.type),
  });

  assert.equal(openCount, 2);
  assert.equal(disposeCount, 1);
  assert.notEqual(first, second);
  assert.deepEqual(lifecycleEvents, ["connection-reconnect", "connection-open"]);
  assert.equal(manager.listInventory()[0]?.runtimeConnectionId, "conn-2");
});
