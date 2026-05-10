import { isWildcardHost, type HelmSummary } from "@tiller/shared";

type StorageLike = Pick<Storage, "getItem">;

type LocationLike = Pick<Location, "protocol" | "hostname" | "host" | "port">;

export const DAEMON_HOST_KEY = "tiller.daemon-host";
export const DAEMON_PORT_KEY = "tiller.daemon-port";

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

  const savedPort = input.storage.getItem(DAEMON_PORT_KEY);

  return {
    host: input.location.hostname || input.fallbackHost,
    port: savedPort ?? input.fallbackPort,
  };
}

export function createHelmWebSocketUrl(input: CreateHelmWebSocketUrlInput) {
  if (input.embedded) {
    const protocol = input.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${input.location.host}`;
  }
  return `ws://${input.host}:${input.port}`;
}

export function normalizeEmbeddedHelmSummaries(input: {
  embedded: boolean;
  host: string;
  port: string;
  helms: HelmSummary[];
}) {
  const endpointPort = Number(input.port);
  return input.helms.map((helm) => {
    const endpointPortMatches = Number.isFinite(endpointPort) && helm.port === endpointPort;
    const shouldUseCurrentEndpoint = input.embedded || (isWildcardHost(helm.host) && endpointPortMatches);
    if (!shouldUseCurrentEndpoint) {
      return helm;
    }

    return {
      ...helm,
      host: input.host,
      port: Number.isFinite(endpointPort) ? endpointPort : helm.port,
    };
  });
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
