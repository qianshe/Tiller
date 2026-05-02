import { connect } from "node:net";
import { networkInterfaces } from "node:os";

export type HelmPortAvailabilityInput = {
  host: string;
  port: number;
  timeoutMs?: number;
};

export async function assertHelmPortAvailable({ host, port, timeoutMs = 250 }: HelmPortAvailabilityInput) {
  const occupiedHosts: string[] = [];
  for (const probeHost of resolvePortProbeHosts(host)) {
    if (await canConnect(probeHost, port, timeoutMs)) {
      occupiedHosts.push(probeHost);
    }
  }

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
  if (normalizedHost === "0.0.0.0" || normalizedHost === "::") {
    return unique(["127.0.0.1", "::1", ...resolveLanAddresses()]);
  }
  if (normalizedHost === "localhost") {
    return ["127.0.0.1", "::1"];
  }
  return [host];
}

function resolveLanAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
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
