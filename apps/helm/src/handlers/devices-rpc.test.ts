import assert from "node:assert/strict";
import test from "node:test";
import { handleDeviceRpcRequest } from "./devices-rpc";

test("device RPC lists trusted devices", async () => {
  const device = { deviceId: "deck-1" };
  const result = await handleDeviceRpcRequest("device/list", {}, {
    trustedDeviceStore: { list: () => [device] },
    toTrustedDeviceSummary: (record: unknown) => record,
  } as any);

  assert.deepEqual(result, { devices: [device] });
});

test("device RPC accepts authentication after socket auth is already established", async () => {
  const result = await handleDeviceRpcRequest("device/authenticate", {
    deviceId: "deck-1",
    token: "cached-token",
  }, {} as any);

  assert.deepEqual(result, {
    ok: true,
    message: "Device already authenticated.",
  });
});

test("device RPC rejects pairing after socket auth is already established", async () => {
  const result = await handleDeviceRpcRequest("device/pair", {
    pairingCode: "123456",
    deviceId: "deck-1",
    deviceName: "Deck",
    clientKind: "deck",
  }, {} as any);

  assert.deepEqual(result, {
    ok: false,
    message: "Pairing is only available before socket authentication.",
  });
});

test("device RPC revokes trusted devices and closes active sockets", async () => {
  const closed: string[] = [];
  const removed: string[] = [];
  const result = await handleDeviceRpcRequest("device/revoke", { deviceId: "deck-1" }, {
    trustedDeviceStore: { revoke: () => true },
    authenticatedSockets: {
      listForDevice: () => [
        { socketId: "sock-1", socket: { close: () => closed.push("sock-1") } },
      ],
      remove: (socketId: string) => removed.push(socketId),
    },
  } as any);

  assert.deepEqual(result, {
    ok: true,
    deviceId: "deck-1",
    message: "Beacon revoked.",
  });
  assert.deepEqual(removed, ["sock-1"]);
  assert.deepEqual(closed, ["sock-1"]);
});
