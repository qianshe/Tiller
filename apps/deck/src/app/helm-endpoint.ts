import type { HelmSummary } from "@tiller/shared";

type StorageLike = Pick<Storage, "getItem">;

type LocationLike = Pick<Location, "protocol" | "hostname" | "host" | "port">;

export type ResolveDefaultHelmEndpointInput = {
  embedded: boolean;
  location: LocationLike;
  storage: StorageLike;
  fallbackHost: string;
  fallbackPort: string;
};

export type CreateHelmWebSocketUrlInput = {
  embedded: boolean;
  host: string;
  port: string;
  location: Pick<Location, "protocol" | "host">;
};

export function resolveDefaultHelmEndpoint(input: ResolveDefaultHelmEndpointInput) {
  if (input.embedded) {
    return {
      host: input.location.hostname || input.fallbackHost,
      port: input.location.port || defaultPortForProtocol(input.location.protocol) || input.fallbackPort,
    };
  }

  return {
    host: input.storage.getItem("tiller.daemon-host") ?? input.fallbackHost,
    port: input.storage.getItem("tiller.daemon-port") ?? input.fallbackPort,
  };
}

export function createHelmWebSocketUrl(input: CreateHelmWebSocketUrlInput) {
  if (input.embedded) {
    const protocol = input.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${input.location.host}`;
  }
  return `ws://${input.host}:${input.port}`;
}

export function shouldRequestInitialSyncOnOpen(input: { embedded: boolean; hasTrustedDeviceCache: boolean }) {
  return input.embedded || input.hasTrustedDeviceCache;
}

export function normalizeEmbeddedHelmSummaries(input: {
  embedded: boolean;
  host: string;
  port: string;
  helms: HelmSummary[];
}) {
  if (!input.embedded) {
    return input.helms;
  }

  const endpointPort = Number(input.port);
  return input.helms.map((helm) => ({
    ...helm,
    host: input.host,
    port: Number.isFinite(endpointPort) ? endpointPort : helm.port,
  }));
}

function defaultPortForProtocol(protocol: string) {
  if (protocol === "https:") {
    return "443";
  }
  if (protocol === "http:") {
    return "80";
  }
  return "";
}
