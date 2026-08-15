import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createReleasePlan, writeGitHubOutputs } from "./release-plan.mjs";

test("createReleasePlan leaves a declared stable version unchanged", () => {
  assert.deepEqual(createReleasePlan("current", "0.1.10"), {
    bump: "current",
    distTag: "latest",
    npmVersionArgs: [],
  });
});

test("createReleasePlan maps a declared prerelease to preview", () => {
  assert.deepEqual(createReleasePlan("current", "0.1.11-alpha.1"), {
    bump: "current",
    distTag: "preview",
    npmVersionArgs: [],
  });
});

test("createReleasePlan maps prerelease bumps to preview dist-tag", () => {
  assert.deepEqual(createReleasePlan("prerelease-alpha"), {
    bump: "prerelease-alpha",
    distTag: "preview",
    npmVersionArgs: ["prerelease", "--preid", "alpha"],
  });
  assert.deepEqual(createReleasePlan("prerelease-beta"), {
    bump: "prerelease-beta",
    distTag: "preview",
    npmVersionArgs: ["prerelease", "--preid", "beta"],
  });
  assert.deepEqual(createReleasePlan("prerelease-rc"), {
    bump: "prerelease-rc",
    distTag: "preview",
    npmVersionArgs: ["prerelease", "--preid", "rc"],
  });
});

test("createReleasePlan maps stable bumps to latest dist-tag", () => {
  assert.deepEqual(createReleasePlan("patch"), {
    bump: "patch",
    distTag: "latest",
    npmVersionArgs: ["patch"],
  });
  assert.deepEqual(createReleasePlan("minor"), {
    bump: "minor",
    distTag: "latest",
    npmVersionArgs: ["minor"],
  });
  assert.deepEqual(createReleasePlan("major"), {
    bump: "major",
    distTag: "latest",
    npmVersionArgs: ["major"],
  });
});

test("createReleasePlan rejects unsupported bumps", () => {
  assert.throws(() => createReleasePlan("latest"), /Unsupported bump type/u);
});

test("writeGitHubOutputs writes workflow output keys", () => {
  let text = "";
  writeGitHubOutputs(createReleasePlan("prerelease-alpha"), {
    write(chunk) {
      text += chunk;
    },
  });

  assert.equal(
    text,
    [
      "bump=prerelease-alpha",
      "dist_tag=preview",
      "npm_version_args=prerelease --preid alpha",
      "",
    ].join("\n"),
  );
});

test("release-plan CLI writes GitHub outputs", () => {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./release-plan.mjs", import.meta.url)), "patch"],
    {
      encoding: "utf8",
    },
  );

  assert.equal(output, ["bump=patch", "dist_tag=latest", "npm_version_args=patch", ""].join("\n"));
});
