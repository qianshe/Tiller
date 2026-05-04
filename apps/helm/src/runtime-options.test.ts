import assert from "node:assert/strict";
import test from "node:test";
import { resolveTillerRuntimeOptions } from "./runtime-options.js";

test("resolveTillerRuntimeOptions defaults to LAN host and default port", () => {
  const options = resolveTillerRuntimeOptions({ argv: [], env: {}, config: {} });

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 47631);
});

test("resolveTillerRuntimeOptions gives CLI args priority over env and config", () => {
  const options = resolveTillerRuntimeOptions({
    argv: ["start", "--host", "127.0.0.1", "--port", "49000"],
    env: { TILLER_HOST: "0.0.0.0", TILLER_PORT: "48000" },
    config: { daemon: { host: "192.168.1.20", port: 47000 } },
  });

  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 49000);
});

test("resolveTillerRuntimeOptions falls back from env to config to defaults", () => {
  assert.deepEqual(
    resolveTillerRuntimeOptions({
      argv: [],
      env: { TILLER_PORT: "48000" },
      config: { daemon: { host: "192.168.1.20", port: 47000 } },
    }),
    {
      host: "192.168.1.20",
      port: 48000,
      authMode: "none",
    },
  );
});

test("resolveTillerRuntimeOptions rejects invalid ports", () => {
  assert.throws(
    () => resolveTillerRuntimeOptions({ argv: ["--port", "70000"], env: {}, config: {} }),
    /Invalid Tiller port/u,
  );
});

test("resolveTillerRuntimeOptions defaults to personal mode without pairing auth", () => {
  const options = resolveTillerRuntimeOptions({ argv: [], env: {}, config: {} });

  assert.equal(options.authMode, "none");
});

test("resolveTillerRuntimeOptions allows pairing auth via env", () => {
  const options = resolveTillerRuntimeOptions({
    argv: [],
    env: { TILLER_AUTH: "pairing" },
    config: {},
  });

  assert.equal(options.authMode, "pairing");
});
