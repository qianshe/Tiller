import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveHelmHealthStatus,
  shouldAttemptSilentReconnect,
  shouldEnsureLiveConnection,
  shouldRunSilentReconnect,
} from "./reconnect-policy.js";

test("hybrid connection policy requires live connect for server-backed views", () => {
  assert.equal(shouldEnsureLiveConnection("sessions"), true);
  assert.equal(shouldEnsureLiveConnection("agents"), true);
  assert.equal(shouldEnsureLiveConnection("settings"), true);
  assert.equal(shouldEnsureLiveConnection("overview"), false);
});

test("silent reconnect is allowed without a token so personal-auth Helm can sync", () => {
  assert.equal(
    shouldAttemptSilentReconnect({
      connection: "disconnected",
      tokenPresent: false,
      host: "127.0.0.1",
      port: "47631",
    }),
    true,
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

test("silent reconnect runs for a normal local Helm without a token", () => {
  assert.equal(
    shouldRunSilentReconnect({
      missionVisualMode: false,
      connection: "disconnected",
      tokenPresent: false,
      embedded: false,
      host: "127.0.0.1",
      port: "47631",
    }),
    true,
  );
});

test("health status follows the primary connection without a probe socket", () => {
  assert.equal(
    resolveHelmHealthStatus({
      connection: "connected",
      host: "127.0.0.1",
      port: "47631",
    }),
    "healthy",
  );
  assert.equal(
    resolveHelmHealthStatus({
      connection: "connecting",
      host: "127.0.0.1",
      port: "47631",
    }),
    "unknown",
  );
  assert.equal(
    resolveHelmHealthStatus({
      connection: "disconnected",
      host: "127.0.0.1",
      port: "47631",
    }),
    "unhealthy",
  );
  assert.equal(
    resolveHelmHealthStatus({
      connection: "disconnected",
      host: "",
      port: "47631",
    }),
    "unknown",
  );
});
