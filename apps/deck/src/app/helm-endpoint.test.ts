import assert from "node:assert/strict";
import test from "node:test";
import { createHelmWebSocketUrl, normalizeEmbeddedHelmSummaries, resolveDefaultHelmEndpoint } from "./helm-endpoint.js";

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

test("normalizeEmbeddedHelmSummaries rewrites embedded Helm endpoint to current browser endpoint", () => {
  const helms = normalizeEmbeddedHelmSummaries({
    embedded: true,
    host: "127.0.0.1",
    port: "47631",
    helms: [{ id: "local-helm", name: "Local Helm", host: "0.0.0.0", port: 47631 }],
  });

  assert.deepEqual(helms, [{ id: "local-helm", name: "Local Helm", host: "127.0.0.1", port: 47631 }]);
});

test("normalizeEmbeddedHelmSummaries rewrites wildcard Helm endpoint to current dev connection endpoint", () => {
  const helms = normalizeEmbeddedHelmSummaries({
    embedded: false,
    host: "127.0.0.1",
    port: "47631",
    helms: [{ id: "local-helm", name: "Local Helm", host: "0.0.0.0", port: 47631 }],
  });

  assert.deepEqual(helms, [{ id: "local-helm", name: "Local Helm", host: "127.0.0.1", port: 47631 }]);
});

test("normalizeEmbeddedHelmSummaries keeps non-wildcard public web endpoints unchanged", () => {
  const helms = normalizeEmbeddedHelmSummaries({
    embedded: false,
    host: "127.0.0.1",
    port: "47631",
    helms: [{ id: "remote-helm", name: "Remote Helm", host: "10.0.0.8", port: 47631 }],
  });

  assert.deepEqual(helms, [{ id: "remote-helm", name: "Remote Helm", host: "10.0.0.8", port: 47631 }]);
});
