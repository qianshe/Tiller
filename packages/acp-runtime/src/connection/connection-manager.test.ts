import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, WorktreeSummary } from "@tiller/shared";
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

const worktree: WorktreeSummary = {
  name: "Tiller",
  path: "D:/myProject/tools/Tiller",
};

test("connection key includes cwd and session config", () => {
  const base = resolveAcpConnectionKey({ provider, worktree });
  const configured = resolveAcpConnectionKey({
    provider,
    worktree,
    sessionConfig: { model: "gpt-5.5", reasoningEffort: "high" },
  });
  const otherConfig = resolveAcpConnectionKey({
    provider,
    worktree,
    sessionConfig: { model: "gpt-5.4", reasoningEffort: "low" },
  });
  const otherWorktree = resolveAcpConnectionKey({
    provider,
    worktree: { ...worktree, path: "D:/other" },
    sessionConfig: { model: "gpt-5.5", reasoningEffort: "high" },
  });

  assert.notEqual(base, configured);
  assert.notEqual(configured, otherConfig);
  assert.notEqual(configured, otherWorktree);
});

test("connection key changes when provider launch identity changes", () => {
  const base = resolveAcpConnectionKey({ provider, worktree });
  const differentCommand = resolveAcpConnectionKey({
    provider: { ...provider, command: "opencode", args: ["acp"] },
    worktree,
  });
  const differentEnv = resolveAcpConnectionKey({
    provider: { ...provider, env: { SAFE_PUBLIC_FLAG: "2" } },
    worktree,
  });

  assert.notEqual(base, differentCommand);
  assert.notEqual(base, differentEnv);
});

test("connection lifecycle events expose cwd without worktree id", async () => {
  const events: unknown[] = [];
  const manager = createAcpConnectionManager({
    openConnection: async () => ({
      inventory: () => ({
        key: resolveAcpConnectionKey({ provider, worktree }),
        providerId: provider.id,
        cwd: worktree.path,
        launchCwd: worktree.path,
        status: "ready" as const,
        runtimeConnectionId: "conn-1",
        initialized: true,
        activeSessionCount: 0,
        pendingSessionCount: 0,
        sessions: [],
        capabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
      }),
      dispose: async () => undefined,
      openOrCreateSession: async () => {
        throw new Error("not used");
      },
    }),
  });

  await manager.openConnection({
    provider,
    worktree,
    onLifecycleEvent: (event) => events.push(event),
  });

  assert.deepEqual(events, [{
    type: "connection-open",
    key: resolveAcpConnectionKey({ provider, worktree }),
    providerId: provider.id,
    cwd: worktree.path,
    sessionId: undefined,
  }]);
  assert.equal(Object.hasOwn(events[0] as object, "worktreeId"), false);
});

test("connection manager reuses an in-flight connection open", async () => {
  let openCount = 0;
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, worktree }),
          providerId: provider.id,
            cwd: worktree.path,
          launchCwd: worktree.path,
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
          configure: async () => ({ runtimeApplied: false, state: {}, modelState: undefined, options: [] }),
          respondPermission: () => undefined,
          attachTillerSession: () => undefined,
          deleteSession: async () => ({ kind: "unsupported", providerId: provider.id, message: "unsupported" }),
          close: async () => ({ kind: "remote-closed", providerId: provider.id, message: "closed" }),
          cancel: () => undefined,
          supportsPermissionResponses: true,
        }),
      };
    },
  });

  const [first, second] = await Promise.all([
    manager.openConnection({ provider, worktree }),
    manager.openConnection({ provider, worktree }),
  ]);

  assert.equal(openCount, 1);
  assert.equal(first, second);
  assert.equal(manager.listInventory().length, 1);
});

test("connection manager reuses one provider connection across session worktrees", async () => {
  let openCount = 0;
  const receivedWorktrees: string[] = [];
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, worktree }),
          providerId: provider.id,
            cwd: worktree.path,
          launchCwd: provider.cwd ?? worktree.path,
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
          receivedWorktrees.push(request.worktree.path);
          return {
            runtimeSessionId: "runtime-session-1",
            sessionCapabilities: { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: true, sessionDelete: false, imageInput: true },
            sessionConfigState: {},
            sessionConfigOptions: [],
            sessionModelState: undefined,
            prompt: async () => undefined,
            configure: async () => ({ runtimeApplied: false, state: {}, modelState: undefined, options: [] }),
            respondPermission: () => undefined,
            attachTillerSession: () => undefined,
            deleteSession: async () => ({ kind: "unsupported", providerId: provider.id, message: "unsupported" }),
            close: async () => ({ kind: "remote-closed", providerId: provider.id, message: "closed" }),
            cancel: () => undefined,
            supportsPermissionResponses: true,
          };
        },
      };
    },
  });

  await manager.openSession({ provider, worktree, sessionId: "session-1", onEvent: () => undefined });
  await manager.openSession({
    provider,
    worktree: { ...worktree, path: "D:/other" },
    sessionId: "session-2",
    onEvent: () => undefined,
  });

  assert.equal(openCount, 1);
  assert.deepEqual(receivedWorktrees, [worktree.path, "D:/other"]);
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
          key: resolveAcpConnectionKey({ provider, worktree }),
          providerId: provider.id,
            cwd: worktree.path,
          launchCwd: worktree.path,
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
          configure: async () => ({ runtimeApplied: false, state: {}, modelState: undefined, options: [] }),
          respondPermission: () => undefined,
          attachTillerSession: () => undefined,
          deleteSession: async () => ({ kind: "unsupported", providerId: provider.id, message: "unsupported" }),
          close: async () => ({ kind: "remote-closed", providerId: provider.id, message: "closed" }),
          cancel: () => undefined,
          supportsPermissionResponses: true,
        }),
      };
    },
  });

  const first = await manager.openConnection({ provider, worktree });
  await first.dispose();
  const second = await manager.openConnection({ provider, worktree });

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
          key: resolveAcpConnectionKey({ provider, worktree }),
          providerId: provider.id,
            cwd: worktree.path,
          launchCwd: worktree.path,
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

  const first = await manager.openConnection({ provider, worktree });
  const second = await manager.reconnect({
    provider,
    worktree,
    onLifecycleEvent: (event) => lifecycleEvents.push(event.type),
  });

  assert.equal(openCount, 2);
  assert.equal(disposeCount, 1);
  assert.notEqual(first, second);
  assert.deepEqual(lifecycleEvents, ["connection-reconnect", "connection-open"]);
  assert.equal(manager.listInventory()[0]?.runtimeConnectionId, "conn-2");
});

test("connection manager disposeAll closes cached and pending connections", async () => {
  let openCount = 0;
  let disposeCount = 0;
  let resolvePending: ((connection: Awaited<ReturnType<typeof manager.openConnection>>) => void) | undefined;
  const manager = createAcpConnectionManager({
    openConnection: async () => {
      openCount += 1;
      if (openCount === 2) {
        return await new Promise((resolve) => {
          resolvePending = resolve;
        });
      }
      return {
        inventory: () => ({
          key: resolveAcpConnectionKey({ provider, worktree }),
          providerId: provider.id,
            cwd: worktree.path,
          launchCwd: worktree.path,
          status: "ready" as const,
          runtimeConnectionId: `conn-${openCount}`,
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
          throw new Error("disposeAll should not create sessions");
        },
      };
    },
  });

  await manager.openConnection({ provider, worktree });
  const pending = manager.openConnection({
    provider: { ...provider, id: "claudecode", name: "ClaudeCode", command: "claude-agent-acp", args: [] },
    worktree,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const disposePromise = manager.disposeAll();
  resolvePending?.({
    inventory: () => ({
      key: "acp:claudecode:pending",
      providerId: "claudecode",
      cwd: worktree.path,
      launchCwd: worktree.path,
      status: "ready" as const,
      runtimeConnectionId: "conn-pending",
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
      throw new Error("disposeAll should not create sessions");
    },
  });
  await Promise.all([pending.catch(() => undefined), disposePromise]);

  assert.equal(disposeCount, 2);
  assert.deepEqual(manager.listInventory(), []);
});
