import assert from "node:assert/strict";
import test from "node:test";
import { clearTrustedDeviceCache, getOrCreateDeviceId, readTrustedDeviceCache, writeTrustedDeviceCache } from "./trusted-device-cache.js";

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

test("trusted device cache persists deviceId and token by host and port", () => {
  const storage = createMemoryStorage();
  writeTrustedDeviceCache(storage, "127.0.0.1", "47631", {
    deviceId: "deck-web-1",
    token: "secret",
    trustedUntil: "2026-05-04T10:00:00.000Z",
  });

  assert.deepEqual(readTrustedDeviceCache(storage, "127.0.0.1", "47631"), {
    deviceId: "deck-web-1",
    token: "secret",
    trustedUntil: "2026-05-04T10:00:00.000Z",
    lastAuthenticatedAt: undefined,
  });
});

test("trusted device cache clears host-scoped auth records without deleting device id", () => {
  const storage = createMemoryStorage();
  const deviceId = getOrCreateDeviceId(storage, "device-seed");
  writeTrustedDeviceCache(storage, "127.0.0.1", "47631", {
    deviceId,
    token: "secret",
  });

  clearTrustedDeviceCache(storage, "127.0.0.1", "47631");

  assert.equal(readTrustedDeviceCache(storage, "127.0.0.1", "47631"), null);
  assert.equal(getOrCreateDeviceId(storage, "ignored-seed"), "device-seed");
});
