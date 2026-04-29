import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("trusted device store authenticates a valid device and slides expiry by 7 days", async () => {
  const mod = await import("./beacon-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-beacon-store-"));

  try {
    const filePath = join(tempRoot, "trusted-devices.json");
    const store = mod.createTrustedDeviceStore(filePath, { now: () => new Date("2026-04-27T10:00:00.000Z") });
    const issued = store.issue({
      deviceId: "deck-web-1",
      deviceName: "Chrome on iPhone",
      clientKind: "web",
    });

    const authed = store.authenticate({ deviceId: "deck-web-1", token: issued.token });

    assert.equal(authed.ok, true);
    if (!authed.ok) {
      throw new Error("expected auth ok");
    }
    assert.equal(authed.record.deviceId, "deck-web-1");
    assert.equal(authed.record.expiresAt, "2026-05-04T10:00:00.000Z");
    const persisted = JSON.parse(readFileSync(filePath, "utf-8")) as { devices: Array<{ deviceId: string }> };
    assert.equal(persisted.devices[0]?.deviceId, "deck-web-1");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("trusted device store rejects expired devices with requiresPairing", async () => {
  const mod = await import("./beacon-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-beacon-store-expired-"));

  try {
    const filePath = join(tempRoot, "trusted-devices.json");
    writeFileSync(filePath, JSON.stringify({
      devices: [{
        deviceId: "deck-web-1",
        deviceName: "Chrome on iPhone",
        clientKind: "web",
        tokenHash: "stale",
        createdAt: "2026-04-01T10:00:00.000Z",
        lastSeenAt: "2026-04-01T10:00:00.000Z",
        expiresAt: "2026-04-10T10:00:00.000Z",
        revokedAt: null,
      }],
    }, null, 2));

    const store = mod.createTrustedDeviceStore(filePath, { now: () => new Date("2026-04-27T10:00:00.000Z") });
    const authed = store.authenticate({ deviceId: "deck-web-1", token: "secret" });

    assert.equal(authed.ok, false);
    if (authed.ok) {
      throw new Error("expected auth failure");
    }
    assert.equal(authed.requiresPairing, true);
    assert.equal(authed.reason, "expired");
    assert.deepEqual(store.list(), []);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("trusted device store revokes a device and forces re-pairing", async () => {
  const mod = await import("./beacon-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-beacon-store-revoke-"));

  try {
    const filePath = join(tempRoot, "trusted-devices.json");
    const store = mod.createTrustedDeviceStore(filePath, { now: () => new Date("2026-04-27T10:00:00.000Z") });
    const issued = store.issue({
      deviceId: "deck-web-2",
      deviceName: "Tiller Deck Browser",
      clientKind: "web",
    });

    assert.equal(store.revoke("deck-web-2"), true);
    assert.deepEqual(store.list(), []);

    const authed = store.authenticate({ deviceId: "deck-web-2", token: issued.token });
    assert.equal(authed.ok, false);
    if (authed.ok) {
      throw new Error("expected auth failure after revoke");
    }
    assert.equal(authed.requiresPairing, true);
    assert.equal(authed.reason, "not-found");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
