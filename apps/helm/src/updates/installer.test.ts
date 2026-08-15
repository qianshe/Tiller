import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLatestUpdateCommand,
  resolveUpdateExecutable,
  resolveUpdateSpawnOptions,
} from "./installer.js";

test("resolveUpdateExecutable uses npm.cmd on Windows", () => {
  assert.equal(resolveUpdateExecutable("win32"), "npm.cmd");
  assert.equal(resolveUpdateExecutable("linux"), "npm");
});

test("buildLatestUpdateCommand installs latest Tiller globally", () => {
  assert.deepEqual(buildLatestUpdateCommand("linux"), {
    command: "npm",
    args: ["install", "-g", "@qianshe/tiller@latest"],
  });
  assert.deepEqual(buildLatestUpdateCommand("win32"), {
    command: "npm.cmd",
    args: ["install", "-g", "@qianshe/tiller@latest"],
  });
});

test("resolveUpdateSpawnOptions uses a shell for Windows npm.cmd shims", () => {
  assert.deepEqual(resolveUpdateSpawnOptions("win32"), {
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });
  assert.deepEqual(resolveUpdateSpawnOptions("linux"), {
    stdio: "inherit",
    shell: false,
  });
});
