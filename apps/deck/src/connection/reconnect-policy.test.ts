import assert from "node:assert/strict";
import test from "node:test";
import { shouldAttemptSilentReconnect, shouldEnsureLiveConnection } from "./reconnect-policy.js";

test("hybrid connection policy requires live connect for Mission and Crew views", () => {
  assert.equal(shouldEnsureLiveConnection("sessions"), true);
  assert.equal(shouldEnsureLiveConnection("agents"), true);
  assert.equal(shouldEnsureLiveConnection("overview"), false);
});

test("silent reconnect is skipped when token is missing even if a profile exists", () => {
  assert.equal(
    shouldAttemptSilentReconnect({
      connection: "disconnected",
      tokenPresent: false,
      host: "127.0.0.1",
      port: "47631",
    }),
    false,
  );
});

test("silent reconnect is allowed in embedded personal Helm without token", () => {
  assert.equal(
    shouldAttemptSilentReconnect({
      connection: "disconnected",
      tokenPresent: false,
      embedded: true,
      host: "127.0.0.1",
      port: "47631",
    }),
    true,
  );
});
