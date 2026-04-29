import assert from "node:assert/strict";
import test from "node:test";

test("authenticated socket registry tracks sockets per device and removes them cleanly", async () => {
  const mod = await import("./authenticated-socket-registry.js");
  const registry = mod.createAuthenticatedSocketRegistry<{ readyState: number }>();
  registry.add({
    socketId: "sock-1",
    socket: { readyState: 1 },
    deviceId: "device-1",
    authenticatedAt: "2026-04-27T10:00:00.000Z",
    lastSeenAt: "2026-04-27T10:00:00.000Z",
  });
  registry.add({
    socketId: "sock-2",
    socket: { readyState: 1 },
    deviceId: "device-1",
    authenticatedAt: "2026-04-27T10:00:01.000Z",
    lastSeenAt: "2026-04-27T10:00:01.000Z",
  });

  assert.equal(registry.listForDevice("device-1").length, 2);
  registry.remove("sock-1");
  assert.equal(registry.listForDevice("device-1").length, 1);
});

test("authenticated socket registry lists all open sockets for broadcast", async () => {
  const mod = await import("./authenticated-socket-registry.js");
  const registry = mod.createAuthenticatedSocketRegistry<{ readyState: number }>();
  registry.add({
    socketId: "sock-open",
    socket: { readyState: 1 },
    deviceId: "device-1",
    authenticatedAt: "2026-04-27T10:00:00.000Z",
    lastSeenAt: "2026-04-27T10:00:00.000Z",
  });
  registry.add({
    socketId: "sock-closed",
    socket: { readyState: 3 },
    deviceId: "device-2",
    authenticatedAt: "2026-04-27T10:00:00.000Z",
    lastSeenAt: "2026-04-27T10:00:00.000Z",
  });

  assert.equal(registry.listAll().length, 1);
  assert.equal(registry.listAll()[0]?.socketId, "sock-open");
});
