import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { isWildcardHost } from "@tiller/shared";

export type HelmPortAvailabilityInput = {
  host: string;
  port: number;
  timeoutMs?: number;
};

export async function assertHelmPortAvailable({
  host,
  port,
  timeoutMs = 250,
}: HelmPortAvailabilityInput) {
  const probeHosts = resolvePortProbeHosts(host);
  const probeResults = await Promise.all(
    probeHosts.map(async (probeHost) =>
      (await canConnect(probeHost, port, timeoutMs)) ? probeHost : null,
    ),
  );
  const occupiedHosts = probeResults.filter((value): value is string => value !== null);

  if (occupiedHosts.length) {
    throw new Error(
      [
        `Tiller port ${port} is already in use on ${occupiedHosts.join(", ")}.`,
        "Stop the existing Tiller process, or start this one with --port <other-port> / TILLER_PORT.",
      ].join(" "),
    );
  }
}

export function resolvePortProbeHosts(host: string) {
  const normalizedHost = host.trim().toLowerCase();
  if (isWildcardHost(normalizedHost)) {
    return unique(["127.0.0.1", "::1", ...resolveLanAddresses()]);
  }
  if (normalizedHost === "localhost") {
    return ["127.0.0.1", "::1"];
  }
  return [host];
}

let cachedLanAddresses: string[] | null = null;

export function resolveLanAddresses() {
  if (!cachedLanAddresses) {
    cachedLanAddresses = Object.values(networkInterfaces())
      .flatMap((items) => items ?? [])
      .filter((item) => item.family === "IPv4" && !item.internal)
      .map((item) => item.address);
  }
  return cachedLanAddresses;
}

function canConnect(host: string, port: number, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}
