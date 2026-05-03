import assert from "node:assert/strict";
import test from "node:test";
import { createHelmWebSocketUrl, normalizeEmbeddedHelmSummaries, resolveDefaultHelmEndpoint, shouldRequestInitialSyncOnOpen } from "./helm-endpoint.js";

const storage = {
  getItem(key: string) {
    return key === "tiller.daemon-host" ? "10.0.0.8" : key === "tiller.daemon-port" ? "49000" : null;
  },
};

test("resolveDefaultHelmEndpoint ignores saved endpoints in embedded single Helm mode", () => {
  const endpoint = resolveDefaultHelmEndpoint({
    embedded: true,
    location: { protocol: "http:", hostname: "192.168.1.50", host: "192.168.1.50:47631", port: "47631" },
    storage,
    fallbackHost: "127.0.0.1",
    fallbackPort: "47631",
  });

  assert.deepEqual(endpoint, { host: "192.168.1.50", port: "47631" });
});

test("resolveDefaultHelmEndpoint keeps saved endpoints in development multi Helm mode", () => {
  const endpoint = resolveDefaultHelmEndpoint({
    embedded: false,
    location: { protocol: "http:", hostname: "192.168.1.50", host: "192.168.1.50:47631", port: "47631" },
    storage,
    fallbackHost: "127.0.0.1",
    fallbackPort: "47631",
  });

  assert.deepEqual(endpoint, { host: "10.0.0.8", port: "49000" });
});

test("createHelmWebSocketUrl uses same origin in embedded mode", () => {
  assert.equal(createHelmWebSocketUrl({ embedded: true, host: "ignored", port: "1", location: { protocol: "https:", host: "helm.example.com" } }), "wss://helm.example.com");
});

test("shouldRequestInitialSyncOnOpen syncs embedded Helm even without trusted cache", () => {
  assert.equal(shouldRequestInitialSyncOnOpen({ embedded: true, hasTrustedDeviceCache: false }), true);
});

test("shouldRequestInitialSyncOnOpen optimistically syncs non-embedded Helm without cache (covers personal-auth mode)", () => {
  // Personal-auth helms admit the socket immediately; the deck must request
  // initial sync instead of stalling on a pairing handshake. Pairing-auth
  // helms reply with `error: not authenticated`, which the error handler
  // catches to surface the pairing input.
  assert.equal(shouldRequestInitialSyncOnOpen({ embedded: false, hasTrustedDeviceCache: false }), true);
});

test("shouldRequestInitialSyncOnOpen still syncs when a trusted cache is present (parallel device.auth)", () => {
  assert.equal(shouldRequestInitialSyncOnOpen({ embedded: false, hasTrustedDeviceCache: true }), true);
});

test("normalizeEmbeddedHelmSummaries rewrites embedded Helm endpoint to current browser endpoint", () => {
  const helms = normalizeEmbeddedHelmSummaries({
    embedded: true,
    host: "127.0.0.1",
    port: "47631",
    helms: [{ id: "local-helm", name: "Local Helm", host: "0.0.0.0", port: 47631 }],
  });

  assert.deepEqual(helms, [{ id: "local-helm", name: "Local Helm", host: "127.0.0.1", port: 47631 }]);
});

test("normalizeEmbeddedHelmSummaries keeps public web endpoints unchanged", () => {
  const helms = normalizeEmbeddedHelmSummaries({
    embedded: false,
    host: "127.0.0.1",
    port: "47631",
    helms: [{ id: "local-helm", name: "Local Helm", host: "0.0.0.0", port: 47631 }],
  });

  assert.deepEqual(helms, [{ id: "local-helm", name: "Local Helm", host: "0.0.0.0", port: 47631 }]);
});
