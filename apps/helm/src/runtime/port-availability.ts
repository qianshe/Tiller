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

type NetworkInterfaceAddressLike = {
  address: string;
  family: string | number;
  internal: boolean;
};

type NetworkInterfaceMapLike = Record<string, NetworkInterfaceAddressLike[] | undefined>;

export function resolveLanAddresses() {
  if (!cachedLanAddresses) {
    cachedLanAddresses = resolveLanAddressesFromInterfaces(networkInterfaces());
  }
  return cachedLanAddresses;
}

export function resolveLanAddressesFromInterfaces(interfaces: NetworkInterfaceMapLike) {
  let order = 0;
  return unique(
    Object.entries(interfaces)
      .flatMap(([name, items]) =>
        (items ?? []).map((item) => ({
          address: item.address,
          family: item.family,
          internal: item.internal,
          name,
          order: order++,
        })),
      )
      .filter((item) => item.family === "IPv4" && !item.internal)
      .filter((item) => isDisplayLanAddress(item.address))
      .sort((left, right) => compareDisplayAddress(left, right))
      .map((item) => item.address),
  );
}

function compareDisplayAddress(
  left: { name: string; order: number },
  right: { name: string; order: number },
) {
  return adapterScore(left.name) - adapterScore(right.name) || left.order - right.order;
}

function adapterScore(name: string) {
  return /virtual|vethernet|vmware|virtualbox|hyper-v|wsl/iu.test(name) ? 10 : 0;
}

function isDisplayLanAddress(address: string) {
  const octets = parseIpv4Octets(address);
  if (!octets) {
    return false;
  }
  if (octets[0] === 169 && octets[1] === 254) {
    return false;
  }
  if (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) {
    return false;
  }
  return true;
}

function parseIpv4Octets(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
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
