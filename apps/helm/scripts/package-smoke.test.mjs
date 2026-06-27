import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNpmPackTarballPath,
  resolveInstalledTillerExecutable,
  SMOKE_COMMAND_ARGS,
} from "./package-smoke.mjs";

function createFakePathApi(separator) {
  return {
    resolve: (...segments) => segments.join(separator),
  };
}

test("package smoke parses npm pack json output", () => {
  const tarballPath = parseNpmPackTarballPath(
    JSON.stringify([{ filename: "qianshe-tiller-0.1.5.tgz" }]),
    "C:/tmp/tarballs",
    createFakePathApi("::"),
  );

  assert.equal(tarballPath, "C:/tmp/tarballs::qianshe-tiller-0.1.5.tgz");
});

test("package smoke resolves Windows-installed tiller shim", () => {
  const executable = resolveInstalledTillerExecutable(
    "D:/tmp/tiller-prefix",
    "win32",
    (candidate) => candidate === "D:/tmp/tiller-prefix::tiller.cmd",
    createFakePathApi("::"),
  );

  assert.equal(executable, "D:/tmp/tiller-prefix::tiller.cmd");
});

test("package smoke resolves POSIX-installed tiller binary", () => {
  const executable = resolveInstalledTillerExecutable(
    "/tmp/tiller-prefix",
    "linux",
    (candidate) => candidate === "/tmp/tiller-prefix/bin/tiller",
    createFakePathApi("/"),
  );

  assert.equal(executable, "/tmp/tiller-prefix/bin/tiller");
});

test("package smoke uses start help as the install verification command", () => {
  assert.deepEqual(SMOKE_COMMAND_ARGS, ["start", "--help"]);
});
