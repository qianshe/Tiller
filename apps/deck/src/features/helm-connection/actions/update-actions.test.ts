import assert from "node:assert/strict";
import test from "node:test";
import { createHelmUpdateActions } from "./update-actions";
import type { DeckRpcClient } from "../rpc-client";

function createHarness(update = {
  status: "available" as const,
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  updateAvailable: true,
  canUpdate: true,
}) {
  const client = { socket: { readyState: 1 } } as unknown as DeckRpcClient;
  const applied: Array<{ helmKey: string; update: Record<string, unknown> }> = [];
  const inventory = {
    helmInventories: {
      "127.0.0.1:47631": {
        projects: [],
        worktrees: [],
        agents: [],
        sessions: [],
        statuses: {},
        trustedDevices: [],
        update,
      },
    },
    applyHelmInventory: (helmKey: string, patch: { update?: Record<string, unknown> }) => {
      if (patch.update) applied.push({ helmKey, update: patch.update });
    },
  };
  const calls: Array<{ method: string; params: unknown }> = [];
  const actions = createHelmUpdateActions({
    runtime: {
      primaryHelmKeyRef: { current: "127.0.0.1:47631" },
      rpcClientRef: { current: client },
      helmRpcClientRefs: { current: new Map() },
    },
    inventory,
    resolveCurrentHelmKey: () => "127.0.0.1:47631",
    dispatch: async (_target, method, params) => {
      calls.push({ method, params });
    },
    formatError: (error) => `formatted: ${String(error)}`,
  });
  return { actions, applied, calls };
}

test("update actions select the open primary Helm and force a check", async () => {
  const { actions, calls } = createHarness();

  assert.equal(actions.resolveTarget()?.helmKey, "127.0.0.1:47631");
  await actions.refresh();

  assert.deepEqual(calls, [{ method: "daemon/update/check", params: { force: true } }]);
});

test("update actions expose a failed manual check with a manual command", async () => {
  const { actions, applied } = createHarness();
  const failingActions = createHelmUpdateActions({
    runtime: {
      primaryHelmKeyRef: { current: "127.0.0.1:47631" },
      rpcClientRef: { current: { socket: { readyState: 1 } } as unknown as DeckRpcClient },
      helmRpcClientRefs: { current: new Map() },
    },
    inventory: {
      helmInventories: {
        "127.0.0.1:47631": {
          projects: [],
          worktrees: [],
          agents: [],
          sessions: [],
          statuses: {},
          trustedDevices: [],
          update: actions.getState()!,
        },
      },
      applyHelmInventory: (_helmKey, patch) => {
        if (patch.update) applied.push({ helmKey: "127.0.0.1:47631", update: patch.update });
      },
    },
    resolveCurrentHelmKey: () => "127.0.0.1:47631",
    dispatch: async () => {
      throw new Error("registry unavailable");
    },
    formatError: (error) => `formatted: ${String(error)}`,
  });

  await failingActions.refresh();

  assert.equal(applied.at(-1)?.update.status, "failed");
  assert.equal(applied.at(-1)?.update.checkStatus, "failed");
  assert.equal(applied.at(-1)?.update.manualCommand, "npm install -g @qianshe/tiller@latest");
});

test("update actions start the updater in the installing state", async () => {
  const { actions, applied, calls } = createHarness();

  await actions.start();

  assert.equal(applied.at(-1)?.update.status, "installing");
  assert.deepEqual(calls, [{ method: "daemon/update/start", params: {} }]);
});
