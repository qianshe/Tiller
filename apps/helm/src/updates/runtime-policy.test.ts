import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginConnection } from "./runtime-policy.js";

test("a Deck served by the current Helm can update it", () => {
  assert.equal(
    isSameOriginConnection("http://192.168.1.20:47631", "192.168.1.20:47631"),
    true,
  );
});

test("a Deck connected to another Helm remains read-only", () => {
  assert.equal(
    isSameOriginConnection("http://192.168.1.21:47631", "192.168.1.20:47631"),
    false,
  );
});

test("same-origin localhost connections are local", () => {
  assert.equal(isSameOriginConnection("http://localhost:47631", "localhost:47631"), true);
});

test("development Deck origins are not authorized for a Helm endpoint", () => {
  assert.equal(isSameOriginConnection("http://localhost:5173", "localhost:47631"), false);
  assert.equal(isSameOriginConnection("http://127.0.0.1:5173", "localhost:47631"), false);
  assert.equal(isSameOriginConnection("http://localhost:4173", "localhost:47631"), false);
  assert.equal(isSameOriginConnection("http://[::1]:5173", "[::1]:47631"), false);
});

test("a second Helm on the same host remains read-only", () => {
  assert.equal(isSameOriginConnection("http://localhost:47631", "localhost:47632"), false);
  assert.equal(isSameOriginConnection("http://192.168.1.20:47631", "192.168.1.20:47632"), false);
});

test("same-host LAN Helm connections require the same endpoint port", () => {
  assert.equal(isSameOriginConnection("http://192.168.1.20:47631", "192.168.1.20:47631"), true);
});

test("IPv6 loopback aliases remain local for the same endpoint", () => {
  assert.equal(isSameOriginConnection("http://[::1]:47631", "[::1]:47631"), true);
  assert.equal(isSameOriginConnection("http://localhost:47631", "[::1]:47631"), true);
});

test("missing or malformed origin is not authorized for updates", () => {
  assert.equal(isSameOriginConnection(undefined, "127.0.0.1:47631"), false);
  assert.equal(isSameOriginConnection("not-an-origin", "127.0.0.1:47631"), false);
});
