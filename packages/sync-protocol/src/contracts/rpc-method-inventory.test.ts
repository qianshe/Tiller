import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_NOTIFICATION_METHODS,
  CLIENT_REQUEST_METHODS,
  METHODS,
  SERVER_NOTIFICATION_METHODS,
} from "../methods";
import { RPC_METHOD_INVENTORY, resolveMethodFamily } from "./rpc-method-inventory";

test("RPC method inventory has one entry per public method", () => {
  const expectedMethods = [
    ...CLIENT_REQUEST_METHODS,
    ...CLIENT_NOTIFICATION_METHODS,
    ...SERVER_NOTIFICATION_METHODS,
  ];
  const inventoryMethods = RPC_METHOD_INVENTORY.map((item) => item.method);

  assert.deepEqual(new Set(inventoryMethods), new Set(expectedMethods));
  assert.equal(inventoryMethods.length, expectedMethods.length);
  assert.equal(inventoryMethods.length, new Set(inventoryMethods).size);
});

test("RPC method inventory only references declared descriptors", () => {
  for (const item of RPC_METHOD_INVENTORY) {
    assert.ok(METHODS[item.method], `${item.method} should have a descriptor`);
    assert.equal(item.family, resolveMethodFamily(item.method));
    assert.equal(item.helmHandlerDomain, item.family);
    assert.equal(item.contractPackage, "@tiller/sync-protocol");
  }
});
