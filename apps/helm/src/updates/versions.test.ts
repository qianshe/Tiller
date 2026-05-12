import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, isVersionGreater } from "./versions.js";

test("compareVersions compares core versions", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
});

test("stable version is newer than prerelease with same base", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-alpha.9"), 1);
  assert.equal(compareVersions("1.0.0-alpha.9", "1.0.0"), -1);
});

test("prerelease identifiers are ordered for Tiller channels", () => {
  assert.equal(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0-alpha.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.9"), 1);
});

test("isVersionGreater only returns true for newer candidates", () => {
  assert.equal(isVersionGreater("0.1.1", "0.1.0"), true);
  assert.equal(isVersionGreater("0.1.0", "0.1.0"), false);
  assert.equal(isVersionGreater("0.1.0-alpha.1", "0.1.0"), false);
});
