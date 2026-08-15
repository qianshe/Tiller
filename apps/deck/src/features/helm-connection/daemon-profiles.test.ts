import assert from "node:assert/strict";
import test from "node:test";
import {
  daemonProfileKey,
  mergeDaemonProfile,
  type DaemonProfile,
} from "./daemon-profiles.js";

test("daemon profile keys normalize localhost aliases", () => {
  assert.equal(
    daemonProfileKey(" LOCALHOST ", " 47631 "),
    daemonProfileKey("127.0.0.1", "47631"),
  );
});

test("merging daemon profiles replaces an equivalent localhost endpoint", () => {
  const existing: DaemonProfile = {
    id: "localhost-profile",
    name: "Local Helm",
    host: "localhost",
    port: "47631",
  };
  const replacement: DaemonProfile = {
    id: "loopback-profile",
    name: "Loopback Helm",
    host: "127.0.0.1",
    port: "47631",
  };

  assert.deepEqual(mergeDaemonProfile([existing], replacement), [replacement]);
});
