import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCode, isErrorResponse, rpcError } from "./errors";

test("ErrorCode covers JSON-RPC standard, ACP cancelled, and Tiller business codes", () => {
  assert.equal(ErrorCode.ParseError, -32700);
  assert.equal(ErrorCode.InvalidRequest, -32600);
  assert.equal(ErrorCode.MethodNotFound, -32601);
  assert.equal(ErrorCode.InvalidParams, -32602);
  assert.equal(ErrorCode.InternalError, -32603);
  assert.equal(ErrorCode.Cancelled, -32800);
  assert.equal(ErrorCode.SessionNotFound, -32030);
  assert.equal(ErrorCode.ImageInputUnsupported, -32034);
});

test("rpcError omits data when not supplied and includes it when supplied", () => {
  assert.deepEqual(rpcError(ErrorCode.SessionNotFound, "Session not found"), {
    code: -32030,
    message: "Session not found",
  });
  assert.deepEqual(
    rpcError(ErrorCode.SessionNotFound, "Session not found", { sessionId: "s1" }),
    { code: -32030, message: "Session not found", data: { sessionId: "s1" } },
  );
});

test("isErrorResponse accepts objects with code and message", () => {
  assert.equal(isErrorResponse({ code: -32603, message: "Internal error" }), true);
  assert.equal(isErrorResponse({ code: -32603 }), false);
});
