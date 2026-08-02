import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHelmUpdateIntent,
  HELM_UPDATE_INTENT_TTL_MS,
  isHelmVersionAtLeast,
  readHelmUpdateIntent,
  writeHelmUpdateIntent,
} from "./update-intent";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("Helm update intent survives a read and can be cleared", () => {
  const storage = createMemoryStorage();

  writeHelmUpdateIntent("127.0.0.1:47631", "1.1.0", storage);

  const intent = readHelmUpdateIntent("127.0.0.1:47631", storage);
  assert.equal(intent?.targetVersion, "1.1.0");
  assert.ok(intent?.requestedAt);

  clearHelmUpdateIntent("127.0.0.1:47631", storage);
  assert.equal(readHelmUpdateIntent("127.0.0.1:47631", storage), null);
});

test("invalid Helm update intent is ignored", () => {
  const storage = createMemoryStorage();
  storage.setItem("tiller.helm-update-intent:127.0.0.1%3A47631", "{\"targetVersion\":\"\"}");

  assert.equal(readHelmUpdateIntent("127.0.0.1:47631", storage), null);
});

test("expired Helm update intent is ignored and removed", () => {
  const storage = createMemoryStorage();
  const now = Date.parse("2026-08-02T00:00:00.000Z");
  storage.setItem(
    "tiller.helm-update-intent:127.0.0.1%3A47631",
    JSON.stringify({
      targetVersion: "1.1.0",
      requestedAt: new Date(now - HELM_UPDATE_INTENT_TTL_MS - 1).toISOString(),
    }),
  );

  assert.equal(readHelmUpdateIntent("127.0.0.1:47631", storage, now), null);
  assert.equal(storage.getItem("tiller.helm-update-intent:127.0.0.1%3A47631"), null);
});

test("version confirmation accepts a newer installed version", () => {
  assert.equal(isHelmVersionAtLeast("1.2.0", "1.1.0"), true);
  assert.equal(isHelmVersionAtLeast("1.1.0", "1.1.0"), true);
  assert.equal(isHelmVersionAtLeast("1.1.0-alpha.1", "1.1.0"), false);
  assert.equal(isHelmVersionAtLeast("invalid", "1.1.0"), false);
});
