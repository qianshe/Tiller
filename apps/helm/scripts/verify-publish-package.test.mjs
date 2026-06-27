import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  assertPublishBundleHasNoInternalImports,
  assertPublishManifestIsPortable,
  verifyPublishPackage,
} from "./verify-publish-package.mjs";

test("publish package verification accepts portable manifest and bundle", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-publish-verify-"));
  const publishRoot = join(tempDir, "dist-package");
  const publishDist = join(publishRoot, "dist");
  mkdirSync(publishDist, { recursive: true });
  writeFileSync(
    join(publishRoot, "package.json"),
    JSON.stringify({
      name: "@qianshe/tiller",
      version: "0.1.5",
      dependencies: { yaml: "^2.9.0" },
    }),
    "utf8",
  );
  writeFileSync(join(publishDist, "index.js"), 'import yaml from "yaml";\n', "utf8");

  try {
    verifyPublishPackage({ publishRoot });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("publish package verification rejects workspace protocol dependencies", () => {
  assert.throws(
    () =>
      assertPublishManifestIsPortable({
        name: "@qianshe/tiller",
        dependencies: { yaml: "workspace:*" },
      }),
    /workspace protocol/u,
  );
});

test("publish package verification rejects internal tiller dependencies", () => {
  assert.throws(
    () =>
      assertPublishManifestIsPortable({
        name: "@qianshe/tiller",
        dependencies: { "@tiller/persistence": "^0.1.0" },
      }),
    /internal workspace dependency/u,
  );
});

test("publish package verification rejects internal imports in the bundled runtime", () => {
  assert.throws(
    () =>
      assertPublishBundleHasNoInternalImports('import { foo } from "@tiller/persistence";\n'),
    /internal bare import/u,
  );
});

test("publish package verification ignores plain internal package metadata strings", () => {
  assert.doesNotThrow(() =>
    assertPublishBundleHasNoInternalImports(
      'const contract = { contractPackage: "@tiller/sync-protocol" };\n',
    ),
  );
});
