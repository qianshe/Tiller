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

/**
 * Update authorization follows the Web page's Helm origin, not the browser's
 * TCP address. A Deck served by this Helm is allowed to update it; a Deck
 * served by another Helm is only a remote controller for this connection.
 */
export function isSameOriginConnection(
  origin: string | undefined,
  hostHeader: string | undefined,
): boolean {
  if (!origin || !hostHeader) return false;
  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`http://${hostHeader}`);
    const originHost = originUrl.hostname.toLowerCase();
    const host = hostUrl.hostname.toLowerCase();
    const originPort = originUrl.port || defaultPort(originUrl.protocol);
    const hostPort = hostUrl.port || defaultPort(originUrl.protocol);
    if (originPort === hostPort && (originHost === host || (isLoopbackHost(originHost) && isLoopbackHost(host)))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
