import assert from "node:assert/strict";
import test from "node:test";
import type { TrustedDeviceSummary } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createConnectionSlice, type ConnectionSlice } from "./connection-slice.js";

function createTestStore() {
  return createStore<ConnectionSlice>()((...args) => ({
    ...createConnectionSlice(...args),
  }));
}

test("setEndpoint stores daemon host and port together", () => {
  const store = createTestStore();

  store.getState().setEndpoint({ host: "10.0.0.8", port: "49000" });

  assert.equal(store.getState().daemonHost, "10.0.0.8");
  assert.equal(store.getState().daemonPort, "49000");
});

test("setConnection updates primary connection status", () => {
  const store = createTestStore();

  store.getState().setConnection("connecting");
  store.getState().setConnection("connected");

  assert.equal(store.getState().connection, "connected");
});

test("setTrustedDevices accepts updater functions", () => {
  const store = createTestStore();

  store
    .getState()
    .setTrustedDevices([{ deviceId: "device-1" } as TrustedDeviceSummary]);
  store.getState().setTrustedDevices((current) =>
    current.filter((device) => device.deviceId !== "device-1"),
  );

  assert.deepEqual(store.getState().trustedDevices, []);
});

test("setDebugTrace accepts updater functions", () => {
  const store = createTestStore();

  store.getState().setDebugTrace((current) => ({
    ...current,
    connectClicks: current.connectClicks + 1,
    lastRequestType: "helm/list",
  }));

  assert.equal(store.getState().debugTrace.connectClicks, 1);
  assert.equal(store.getState().debugTrace.lastRequestType, "helm/list");
});
