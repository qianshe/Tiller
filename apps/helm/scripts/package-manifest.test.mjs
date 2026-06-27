import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createPublishPackageManifest, PUBLISH_PACKAGE_NAME, WORKSPACE_PACKAGE_NAME } from "./package-manifest.mjs";

const helmRoot = resolve(import.meta.dirname, "..");

function readWorkspaceManifest() {
  return JSON.parse(readFileSync(resolve(helmRoot, "package.json"), "utf8"));
}

test("Helm keeps the internal workspace package name", () => {
  const manifest = readWorkspaceManifest();

  assert.equal(WORKSPACE_PACKAGE_NAME, "@tiller/helm");
  assert.equal(manifest.name, WORKSPACE_PACKAGE_NAME);
  assert.equal(manifest.private, true);
});

test("publish manifest wraps Helm as the public npm package", () => {
  const manifest = readWorkspaceManifest();
  const publishManifest = createPublishPackageManifest(manifest);

  assert.equal(PUBLISH_PACKAGE_NAME, "@qianshe/tiller");
  assert.equal(publishManifest.name, PUBLISH_PACKAGE_NAME);
  assert.equal(publishManifest.private, undefined);
  assert.deepEqual(publishManifest.bin, { tiller: "./dist/index.js" });
  assert.deepEqual(publishManifest.files, ["dist"]);
  assert.equal(publishManifest.publishConfig.access, "public");
  assert.equal(publishManifest.dependencies.yaml, manifest.dependencies.yaml);
  assert.equal(typeof publishManifest.dependencies.yaml, "string");
  assert.match(publishManifest.dependencies.yaml, /^\^?\d/);
});

test("publish manifest strips internal workspace dependencies", () => {
  const publishManifest = createPublishPackageManifest({
    version: "0.1.5",
    dependencies: {
      yaml: "^2.9.0",
      "@tiller/persistence": "workspace:*",
      "@tiller/shared": "workspace:*",
    },
  });

  assert.deepEqual(publishManifest.dependencies, {
    yaml: "^2.9.0",
  });
});

test("publish manifest rejects non-internal workspace protocol dependencies", () => {
  assert.throws(
    () =>
      createPublishPackageManifest({
        version: "0.1.5",
        dependencies: {
          yaml: "^2.9.0",
          leftpad: "workspace:*",
        },
      }),
    /Unsupported publish dependency protocol/u,
  );
});
