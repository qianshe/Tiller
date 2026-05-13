import assert from "node:assert/strict";
import test from "node:test";
import { createSessionTopicRegistry } from "./session-topics.js";

test("session topic registry tracks socket subscriptions", () => {
  const registry = createSessionTopicRegistry();

  registry.subscribe("socket-1", "session-1");
  registry.subscribe("socket-2", "session-2");
  registry.subscribe("socket-3", "session-1");

  assert.deepEqual(registry.listSubscribers("session-1"), ["socket-1", "socket-3"]);
  assert.deepEqual(registry.listSubscribers("session-2"), ["socket-2"]);
});

test("session topic registry can remove one session or all socket subscriptions", () => {
  const registry = createSessionTopicRegistry();

  registry.subscribe("socket-1", "session-1");
  registry.subscribe("socket-1", "session-2");
  registry.subscribe("socket-2", "session-1");

  registry.unsubscribe("socket-1", "session-1");

  assert.deepEqual(registry.listSubscribers("session-1"), ["socket-2"]);
  assert.deepEqual(registry.listSubscriptions("socket-1"), ["session-2"]);

  registry.removeSocket("socket-1");

  assert.deepEqual(registry.listSubscribers("session-2"), []);
});
