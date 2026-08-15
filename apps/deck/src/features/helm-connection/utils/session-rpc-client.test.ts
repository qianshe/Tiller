import assert from "node:assert/strict";
import test from "node:test";
import type { HelmSummary, SessionSummary } from "@tiller/shared";
import { resolveSessionRpcTarget } from "./session-rpc-client.js";

function client() {
  return { socket: { readyState: 1 } } as any;
}

test("resolves a session Helm id to the connected endpoint client", () => {
  const remoteClient = client();
  const session = { helmId: "local-helm" } as Pick<SessionSummary, "helmId">;
  const helms: HelmSummary[] = [
    { id: "local-helm", name: "Local Helm", host: "127.0.0.1", port: 47631 },
  ];

  const target = resolveSessionRpcTarget({
    session,
    helms,
    currentHelmKey: "127.0.0.1:47631",
    primaryClient: null,
    clients: new Map([["127.0.0.1:47631", remoteClient]]),
  });

  assert.equal(target?.client, remoteClient);
  assert.equal(target?.helmKey, "127.0.0.1:47631");
});

test("uses the primary client for a wildcard Helm bound to the current endpoint", () => {
  const primaryClient = client();
  const session = { helmId: "local-helm" } as Pick<SessionSummary, "helmId">;
  const helms: HelmSummary[] = [
    { id: "local-helm", name: "Local Helm", host: "0.0.0.0", port: 47631 },
  ];

  const target = resolveSessionRpcTarget({
    session,
    helms,
    currentHelmKey: "192.168.1.20:47631",
    primaryClient,
    clients: new Map(),
  });

  assert.equal(target?.client, primaryClient);
  assert.equal(target?.helmKey, "192.168.1.20:47631");
});

test("uses the primary client while the Helm inventory is not ready", () => {
  const primaryClient = client();
  const session = { helmId: "local-helm" } as Pick<SessionSummary, "helmId">;

  const target = resolveSessionRpcTarget({
    session,
    helms: [],
    currentHelmKey: "192.168.1.20:47631",
    primaryClient,
    clients: new Map(),
  });

  assert.equal(target?.client, primaryClient);
  assert.equal(target?.helmKey, "192.168.1.20:47631");
});

test("does not route an unknown remote session to the primary client", () => {
  const primaryClient = client();
  const session = { id: "remote-session", helmId: "remote-helm" } as Pick<SessionSummary, "id" | "helmId">;

  const target = resolveSessionRpcTarget({
    session,
    helms: [],
    currentHelmKey: "192.168.1.20:47631",
    primaryClient,
    clients: new Map(),
    primarySessionIds: new Set(["local-session"]),
  });

  assert.equal(target, null);
});

test("does not fall back to the primary client for a known remote Helm", () => {
  const primaryClient = client();
  const session = { helmId: "remote-helm" } as Pick<SessionSummary, "helmId">;
  const helms: HelmSummary[] = [
    { id: "remote-helm", name: "Remote Helm", host: "192.168.1.30", port: 47631 },
  ];

  const target = resolveSessionRpcTarget({
    session,
    helms,
    currentHelmKey: "192.168.1.20:47631",
    primaryClient,
    clients: new Map(),
  });

  assert.equal(target, null);
});

test("uses the primary client when a current session's Helm endpoint differs", () => {
  const primaryClient = client();
  const session = { id: "session-1", helmId: "local-helm" } as Pick<SessionSummary, "id" | "helmId">;
  const helms: HelmSummary[] = [
    { id: "local-helm", name: "Local Helm", host: "127.0.0.1", port: 47631 },
  ];

  const target = resolveSessionRpcTarget({
    session,
    helms,
    currentHelmKey: "192.168.1.20:47631",
    primaryClient,
    clients: new Map(),
    primarySessionIds: new Set(["session-1"]),
  });

  assert.equal(target?.client, primaryClient);
  assert.equal(target?.helmKey, "192.168.1.20:47631");
});
