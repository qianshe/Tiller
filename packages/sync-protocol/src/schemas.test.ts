import assert from "node:assert/strict";
import test from "node:test";
import { EmptyParamsSchema, OkMessageSchema, StopReasonSchema, optionalString, stringArray, typedUnknown } from "./schemas";

test("EmptyParamsSchema accepts empty object only", () => {
  assert.deepEqual(EmptyParamsSchema.parse({}), {});
  assert.throws(() => EmptyParamsSchema.parse({ unexpected: true }));
});

test("OkMessageSchema parses ok+message", () => {
  assert.deepEqual(OkMessageSchema.parse({ ok: true, message: "saved" }), { ok: true, message: "saved" });
});

test("StopReasonSchema enumerates ACP stop reasons", () => {
  assert.equal(StopReasonSchema.parse("end_turn"), "end_turn");
  assert.throws(() => StopReasonSchema.parse("unknown"));
});

test("helpers parse optional and array primitives", () => {
  assert.equal(optionalString.parse(undefined), undefined);
  assert.deepEqual(stringArray.parse(["a", "b"]), ["a", "b"]);
  assert.deepEqual(typedUnknown<{ ok: boolean }>().parse({ ok: true }), { ok: true });
});
