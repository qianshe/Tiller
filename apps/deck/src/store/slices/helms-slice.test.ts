import assert from "node:assert/strict";
import test from "node:test";
import type { HelmSummary, ProjectSummary } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import type { ConnectionState } from "./connection-slice";
import { createHelmsSlice, type HelmsSlice } from "./helms-slice.js";

function createTestStore() {
  return createStore<HelmsSlice>()((...args) => ({
    ...createHelmsSlice(...args),
  }));
}

function helm(id: string): HelmSummary {
  return {
    id,
    name: `Helm ${id}`,
    host: "127.0.0.1",
    port: 47631,
  } as HelmSummary;
}

function project(id: string): ProjectSummary {
  return { id, name: `Project ${id}`, helmId: "helm-1", worktrees: [] };
}

test("setHelms replaces and updates the helm list", () => {
  const store = createTestStore();

  store.getState().setHelms([helm("helm-1")]);
  store.getState().setHelms((current) => [...current, helm("helm-2")]);

  assert.deepEqual(
    store.getState().helms.map((item) => item.id),
    ["helm-1", "helm-2"],
  );
});

test("applyHelmInventory merges a partial inventory bucket", () => {
  const store = createTestStore();

  store.getState().applyHelmInventory("helm-1", { projects: [project("p1")] });
  store.getState().applyHelmInventory("helm-1", { sessions: [] });

  assert.deepEqual(store.getState().helmInventories["helm-1"]?.projects, [
    project("p1"),
  ]);
  assert.deepEqual(store.getState().helmInventories["helm-1"]?.sessions, []);
});

test("setHelmConnection stores per-helm connection state", () => {
  const store = createTestStore();

  store.getState().setHelmConnection("helm-1", "connected" as ConnectionState);

  assert.equal(store.getState().helmConnectionStates["helm-1"], "connected");
});

test("removeHelm clears inventory and connection state", () => {
  const store = createTestStore();
  store.getState().setHelmConnection("helm-1", "connected" as ConnectionState);
  store.getState().applyHelmInventory("helm-1", { projects: [project("p1")] });

  store.getState().removeHelm("helm-1");

  assert.equal(store.getState().helmConnectionStates["helm-1"], undefined);
  assert.equal(store.getState().helmInventories["helm-1"], undefined);
});
