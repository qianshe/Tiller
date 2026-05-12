import assert from "node:assert/strict";
import test from "node:test";
import { buildLatestUpdateCommand, resolveUpdateExecutable } from "./installer.js";

test("buildLatestUpdateCommand targets npm latest", () => {
  assert.deepEqual(buildLatestUpdateCommand("linux"), {
    command: "npm",
    args: ["install", "-g", "@qianshe/tiller@latest"],
  });
});

test("resolveUpdateExecutable uses npm.cmd on Windows", () => {
  assert.equal(resolveUpdateExecutable("win32"), "npm.cmd");
  assert.equal(resolveUpdateExecutable("linux"), "npm");
});
