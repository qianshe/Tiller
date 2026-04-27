import assert from "node:assert/strict";
import test from "node:test";
import { readDeckSnapshot, writeDeckSnapshot } from "./snapshot-cache.js";

function createMemoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

test("snapshot cache restores the last known project/session view", () => {
  const storage = createMemoryStorage();
  writeDeckSnapshot(storage, {
    profileId: "local-helm",
    cachedAt: "2026-04-27T10:00:00.000Z",
    projects: [{ id: "project-1", name: "Tiller", helmId: "helm-1", workspaceIds: [], allowedAgentIds: [] }],
    sessions: [],
    workspaces: [],
    agents: [],
  });
  assert.equal(readDeckSnapshot(storage, "local-helm")?.projects[0]?.name, "Tiller");
});

test("snapshot cache returns null for invalid JSON", () => {
  const storage = createMemoryStorage();
  storage.setItem("tiller.deck-snapshot.local-helm", "{invalid");
  assert.equal(readDeckSnapshot(storage, "local-helm"), null);
});
