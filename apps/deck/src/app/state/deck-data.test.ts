import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveSessionMessages } from "./active-session-messages";
import { selectDaemonProfilesForDeckData } from "./deck-data";

const storedProfiles = [
  { id: "local", name: "Local Helm", host: "127.0.0.1", port: "47631" },
];

test("embedded daemon profiles selector returns a stable empty snapshot", () => {
  const state = { daemonProfiles: storedProfiles };

  const first = selectDaemonProfilesForDeckData(state, true);
  const second = selectDaemonProfilesForDeckData(state, true);

  assert.deepEqual(first, []);
  assert.equal(first, second);
});

test("non-embedded daemon profiles selector returns the store snapshot", () => {
  const state = { daemonProfiles: storedProfiles };

  assert.equal(selectDaemonProfilesForDeckData(state, false), storedProfiles);
});

test("active session message selector returns only the requested session messages", () => {
  const state = {
    messages: {
      s1: [{ id: "m1", role: "assistant", text: "one", timestamp: "t1" }],
      s2: [{ id: "m2", role: "assistant", text: "two", timestamp: "t2" }],
    },
  } as any;

  assert.deepEqual(selectActiveSessionMessages(state, "s2"), state.messages.s2);
  assert.deepEqual(selectActiveSessionMessages(state, null), []);
});
