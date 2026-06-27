import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { posix, resolve, win32 } from "node:path";
import { tmpdir } from "node:os";

const helmRoot = resolve(import.meta.dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
export const SMOKE_COMMAND_ARGS = ["start", "--help"];

export function parseNpmPackTarballPath(
  output,
  packDirectory,
  pathApi = getPathApiForPlatform(process.platform),
) {
  const parsed = JSON.parse(output);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : undefined;
  if (typeof filename !== "string" || !filename.trim()) {
    throw new Error("npm pack did not report a tarball filename.");
  }
  return pathApi.resolve(packDirectory, filename);
}

export function resolveInstalledTillerExecutable(
  prefix,
  platform = process.platform,
  pathExists = existsSync,
  pathApi = getPathApiForPlatform(platform),
) {
  const resolvePath = (...segments) => pathApi.resolve(...segments);
  const candidates =
    platform === "win32"
      ? [
          resolvePath(prefix, "tiller.cmd"),
          resolvePath(prefix, "tiller"),
          resolvePath(prefix, "node_modules", ".bin", "tiller.cmd"),
          resolvePath(prefix, "node_modules", ".bin", "tiller"),
        ]
      : [
          resolvePath(prefix, "bin", "tiller"),
          resolvePath(prefix, "tiller"),
          resolvePath(prefix, "node_modules", ".bin", "tiller"),
        ];
  const executable = candidates.find((candidate) => pathExists(candidate));
  if (!executable) {
    throw new Error(`Unable to locate installed tiller executable under ${prefix}`);
  }
  return executable;
}

function getPathApiForPlatform(platform) {
  return platform === "win32" ? win32 : posix;
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
