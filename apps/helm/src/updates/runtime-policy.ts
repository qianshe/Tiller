import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isPublishedRuntime(moduleUrl: string, version: string) {
  if (version === "0.0.0-dev") return false;
  try {
    const packagePath = resolve(dirname(fileURLToPath(moduleUrl)), "../package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
    return packageJson.name === "@qianshe/tiller";
  } catch {
    return false;
  }
}

export function isLoopbackAddress(address: string | undefined) {
  if (!address) return true;
  const normalized = address.toLowerCase().replace(/^::ffff:/u, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}
