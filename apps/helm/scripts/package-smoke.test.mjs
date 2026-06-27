import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNpmPackTarballPath,
  resolveInstalledTillerExecutable,
  SMOKE_COMMAND_ARGS,
} from "./package-smoke.mjs";

test("package smoke parses npm pack json output", () => {
  const tarballPath = parseNpmPackTarballPath(
    JSON.stringify([{ filename: "qianshe-tiller-0.1.5.tgz" }]),
    "C:/tmp/tarballs",
  );

  assert.equal(
    tarballPath.replace(/\\/gu, "/"),
    "C:/tmp/tarballs/qianshe-tiller-0.1.5.tgz",
  );
});

test("package smoke resolves Windows-installed tiller shim", () => {
  const executable = resolveInstalledTillerExecutable(
    "D:/tmp/tiller-prefix",
    "win32",
    (candidate) => candidate.endsWith("tiller.cmd"),
  );

  assert.equal(
    executable.replace(/\\/gu, "/"),
    "D:/tmp/tiller-prefix/tiller.cmd",
  );
});

test("package smoke resolves POSIX-installed tiller binary", () => {
  const executable = resolveInstalledTillerExecutable(
    "/tmp/tiller-prefix",
    "linux",
    (candidate) => candidate.replace(/\\/gu, "/").endsWith("/bin/tiller"),
  );

  assert.match(
    executable.replace(/\\/gu, "/"),
    /\/tmp\/tiller-prefix\/bin\/tiller$/u,
  );
});

test("package smoke uses start help as the install verification command", () => {
  assert.deepEqual(SMOKE_COMMAND_ARGS, ["start", "--help"]);
});
