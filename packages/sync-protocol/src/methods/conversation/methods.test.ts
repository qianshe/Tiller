import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_REQUEST_METHODS, SERVER_NOTIFICATION_METHODS } from "../index";
import { validateParams } from "../../index";

test("conversation preparation methods are registered with global updates", () => {
  assert.equal(CLIENT_REQUEST_METHODS.includes("conversation/list"), true);
  assert.equal(CLIENT_REQUEST_METHODS.includes("conversation/save"), true);
  assert.equal(CLIENT_REQUEST_METHODS.includes("conversation/delete"), true);
  assert.equal(CLIENT_REQUEST_METHODS.includes("conversation/start"), true);
  assert.equal(SERVER_NOTIFICATION_METHODS.includes("conversation/update"), true);
});

test("conversation save allows content-only preparations and rejects empty content", () => {
  assert.deepEqual(validateParams("conversation/save", { content: "Record this" }), {
    content: "Record this",
  });
  assert.throws(() => validateParams("conversation/save", { content: "   " }));
});
