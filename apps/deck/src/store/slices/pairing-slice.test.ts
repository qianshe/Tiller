import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { createPairingSlice, type PairingSlice } from "./pairing-slice.js";

function createTestStore() {
  return createStore<PairingSlice>()((...args) => ({
    ...createPairingSlice(...args),
  }));
}

test("setPairingState updates pairing lifecycle", () => {
  const store = createTestStore();

  store.getState().setPairingState("input");
  store.getState().setPairingState("paired");

  assert.equal(store.getState().pairingState, "paired");
});

test("setPairingCodeInput stores sanitized input from callers", () => {
  const store = createTestStore();

  store.getState().setPairingCodeInput("ABC123");

  assert.equal(store.getState().pairingCodeInput, "ABC123");
});

test("feedback setters update pairing and connection messages", () => {
  const store = createTestStore();

  store.getState().setPairingFeedback("请输入配对码");
  store.getState().setConnectFeedback("已连接");

  assert.equal(store.getState().pairingFeedback, "请输入配对码");
  assert.equal(store.getState().connectFeedback, "已连接");
});
