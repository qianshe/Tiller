import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listProjectDirectories } from "./project-files";

test("listProjectDirectories lists child directories for an existing path", async () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-directories-"));
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  mkdirSync(alpha);
  mkdirSync(beta);

  const result = await listProjectDirectories(root);

  assert.equal(result.path, normalizePath(root));
  assert.deepEqual(result.directories.sort(), [normalizePath(alpha), normalizePath(beta)].sort());
});

test("listProjectDirectories filters directories for a partial child path", async () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-directories-"));
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  mkdirSync(alpha);
  mkdirSync(beta);

  const result = await listProjectDirectories(join(root, "al"));

  assert.equal(result.path, normalizePath(root));
  assert.deepEqual(result.directories, [normalizePath(alpha)]);
});

test("listProjectDirectories returns no candidates for an empty path", async () => {
  const result = await listProjectDirectories("");

  assert.deepEqual(result.directories, []);
  assert.equal(result.path, undefined);
});

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/u, "");
}
