import assert from "node:assert/strict";
import test from "node:test";
import { decodeMessage, encodeMessage, validateParams, validateResult } from "./codec";
import { ErrorCode } from "./errors";

test("decodeMessage parses valid request", () => {
  assert.deepEqual(
    decodeMessage('{"jsonrpc":"2.0","id":"1","method":"helm/list","params":{}}'),
    { jsonrpc: "2.0", id: "1", method: "helm/list", params: {} },
  );
});

test("decodeMessage throws ParseError for invalid JSON", () => {
  assert.throws(() => decodeMessage("{"), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.ParseError;
  });
});

test("decodeMessage rejects batch payloads", () => {
  assert.throws(() => decodeMessage("[]"), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.InvalidRequest;
  });
});

test("decodeMessage rejects malformed envelopes", () => {
  assert.throws(() => decodeMessage('{"jsonrpc":"1.0","method":"x"}'), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.InvalidRequest;
  });
});

test("validateParams accepts known method params", () => {
  assert.deepEqual(validateParams("helm/list", {}), {});
  assert.deepEqual(
    validateParams("session/cancel", { sessionId: "s1" }),
    { sessionId: "s1" },
  );
});

test("validateParams reports invalid params with InvalidParams", () => {
  assert.throws(() => validateParams("session/prompt", { sessionId: "s1" }), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.InvalidParams;
  });
});

test("validateParams reports unknown method with MethodNotFound", () => {
  assert.throws(() => validateParams("does/not/exist", {}), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.MethodNotFound;
  });
});

test("validateResult accepts known method results", () => {
  assert.deepEqual(validateResult("helm/list", { helms: [] }), { helms: [] });
});

test("validateResult rejects malformed result payloads", () => {
  assert.throws(() => validateResult("helm/list", { projects: [] }), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.InternalError;
  });
});

test("encodeMessage returns canonical JSON string", () => {
  assert.equal(
    encodeMessage({ jsonrpc: "2.0", id: "1", result: { ok: true } }),
    '{"jsonrpc":"2.0","id":"1","result":{"ok":true}}',
  );
});
