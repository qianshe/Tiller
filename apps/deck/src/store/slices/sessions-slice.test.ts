import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createSessionsSlice, type SessionsSlice } from "./sessions-slice.js";

function createTestStore() {
  return createStore<SessionsSlice>()((...args) => ({
    ...createSessionsSlice(...args),
  }));
}

const session = (id: string): SessionSummary => ({
  id,
  title: `Session ${id}`,
  projectId: "p1",
  projectName: "Project p1",
  helmId: "helm-1",
  workspaceId: "w1",
  workspaceName: "Workspace w1",
  agentId: "a1",
  agentName: "Agent a1",
  messageCount: 0,
  status: "idle",
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
});

test("setSessions supports value and updater forms", () => {
  const store = createTestStore();

  store.getState().setSessions([session("s1")]);
  store.getState().setSessions((current) => [...current, session("s2")]);

  assert.deepEqual(store.getState().sessions.map((item) => item.id), ["s1", "s2"]);
});

test("session metadata actions update status title and active id", () => {
  const store = createTestStore();

  store.getState().setSessionStatus("s1", "running");
  store.getState().setSessionTitle("s1", "Custom title");
  store.getState().setActiveSessionId("s1");

  assert.equal(store.getState().statuses.s1, "running");
  assert.equal(store.getState().sessionTitles.s1, "Custom title");
  assert.equal(store.getState().activeSessionId, "s1");
});

test("config and command maps support updater forms", () => {
  const store = createTestStore();

  store.getState().setSessionConfigOptions({ s1: [] });
  store.getState().setSessionAvailableCommands((current) => ({
    ...current,
    s1: [{ name: "help" }],
  }));
  store.getState().setAgentAvailableCommands((current) => ({
    ...current,
    a1: [{ name: "review" }],
  }));

  assert.deepEqual(store.getState().sessionConfigOptions.s1, []);
  assert.equal(store.getState().sessionAvailableCommands.s1?.[0]?.name, "help");
  assert.equal(store.getState().agentAvailableCommands.a1?.[0]?.name, "review");
});

test("refreshAgentAvailableCommands reloads localStorage cache", () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });

  try {
    const store = createTestStore();
    storage.set(
      "tiller.agent-available-commands",
      JSON.stringify({ a1: [{ name: "review" }] }),
    );

    store.getState().refreshAgentAvailableCommands();

    assert.equal(store.getState().agentAvailableCommands.a1?.[0]?.name, "review");
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("session history state can be marked as loading", () => {
  const store = createTestStore();

  store.getState().setSessionHistoryState((current) => ({
    ...current,
    loading: true,
  }));

  assert.equal(store.getState().sessionHistoryState.loading, true);
});
