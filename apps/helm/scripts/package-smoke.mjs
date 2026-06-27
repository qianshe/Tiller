import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const helmRoot = resolve(import.meta.dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
export const SMOKE_COMMAND_ARGS = ["start", "--help"];

export function parseNpmPackTarballPath(output, packDirectory) {
  const parsed = JSON.parse(output);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : undefined;
  if (typeof filename !== "string" || !filename.trim()) {
    throw new Error("npm pack did not report a tarball filename.");
  }
  return resolve(packDirectory, filename);
}

export function resolveInstalledTillerExecutable(
  prefix,
  platform = process.platform,
  pathExists = existsSync,
) {
  const candidates =
    platform === "win32"
      ? [
          resolve(prefix, "tiller.cmd"),
          resolve(prefix, "tiller"),
          resolve(prefix, "node_modules", ".bin", "tiller.cmd"),
          resolve(prefix, "node_modules", ".bin", "tiller"),
        ]
      : [
          resolve(prefix, "bin", "tiller"),
          resolve(prefix, "tiller"),
          resolve(prefix, "node_modules", ".bin", "tiller"),
        ];
  const executable = candidates.find((candidate) => pathExists(candidate));
  if (!executable) {
    throw new Error(`Unable to locate installed tiller executable under ${prefix}`);
  }
  return executable;
}

export function runPackageSmoke(options = {}) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "tiller-package-smoke-"));
  const cacheDir = resolve(tempRoot, "npm-cache");
  const tarballDir = resolve(tempRoot, "tarball");
  const installPrefix = resolve(tempRoot, "prefix");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(installPrefix, { recursive: true });

  try {
    const packResult = runCommand(
      npmCommand,
      ["pack", "./dist-package", "--json", "--pack-destination", tarballDir, "--cache", cacheDir],
      { cwd: helmRoot, captureStdout: true },
    );
    const tarballPath = parseNpmPackTarballPath(packResult.stdout, tarballDir);

    runCommand(
      npxCommand,
      ["--yes", "--cache", cacheDir, "--package", tarballPath, "tiller", ...SMOKE_COMMAND_ARGS],
      { cwd: helmRoot },
    );

    runCommand(
      npmCommand,
      ["install", "-g", tarballPath, "--prefix", installPrefix, "--cache", cacheDir],
      { cwd: helmRoot },
    );
    const installedExecutable = resolveInstalledTillerExecutable(installPrefix);
    runCommand(installedExecutable, SMOKE_COMMAND_ARGS, { cwd: helmRoot });

    return { tarballPath, installPrefix };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.captureStdout ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${command} ${args.join(" ")}): ${result.status ?? "unknown"}`,
    );
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  runPackageSmoke();
}
