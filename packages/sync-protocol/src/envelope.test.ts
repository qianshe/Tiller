import assert from "node:assert/strict";
import test from "node:test";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from "./envelope";

test("envelope guards identify request, notification, and response", () => {
  assert.equal(
    isJsonRpcRequest({ jsonrpc: "2.0", id: "1", method: "helm/list", params: {} }),
    true,
  );
  assert.equal(
    isJsonRpcNotification({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s1" } }),
    true,
  );
  assert.equal(
    isJsonRpcResponse({ jsonrpc: "2.0", id: "1", result: { ok: true } }),
    true,
  );
  assert.equal(
    isJsonRpcResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
    true,
  );
});

test("request guard rejects null id and missing method", () => {
  assert.equal(isJsonRpcRequest({ jsonrpc: "2.0", id: null, method: "helm/list" }), false);
  assert.equal(isJsonRpcRequest({ jsonrpc: "2.0", id: "1" }), false);
});
