import type { HelmSummary, SessionSummary } from "@tiller/shared";
import { isWildcardHost } from "@tiller/shared";
import type { DeckRpcClient } from "../rpc-client";
import { daemonProfileKey } from "../daemon-profiles";

type RpcClientRefs = ReadonlyMap<string, DeckRpcClient>;

export type SessionRpcTarget = {
  client: DeckRpcClient;
  helmKey: string;
};

export function resolveSessionRpcTarget(input: {
  session: Pick<SessionSummary, "helmId"> & Partial<Pick<SessionSummary, "id">>;
  helms: readonly HelmSummary[];
  currentHelmKey: string;
  primaryClient: DeckRpcClient | null | undefined;
  clients: RpcClientRefs;
  primarySessionIds?: ReadonlySet<string>;
}): SessionRpcTarget | null {
  const helm = input.helms.find((item) => item.id === input.session.helmId);
  const endpointKey = helm
    ? isWildcardHost(helm.host)
      ? input.currentHelmKey
      : daemonProfileKey(helm.host, String(helm.port))
    : null;
  const candidateKeys = Array.from(new Set([
    endpointKey,
    input.session.helmId,
  ].filter((key): key is string => Boolean(key))));

  for (const helmKey of candidateKeys) {
    const client = input.clients.get(helmKey) ??
      (helmKey === input.currentHelmKey ? input.primaryClient : null);
    if (client?.socket.readyState === 1) {
      return { client, helmKey };
    }
  }

  // The initial `helm/list` response can arrive after a user opens a session.
  // In that window there is no reliable logical Helm id to endpoint mapping,
  // but the session list itself came from the primary connection.
  if (
    !helm
    && (input.session.id === undefined || input.primarySessionIds?.has(input.session.id))
    && input.primaryClient?.socket.readyState === 1
  ) {
    return {
      client: input.primaryClient,
      helmKey: input.currentHelmKey,
    };
  }

  // The same Helm can be opened through different addresses on two devices
  // (for example, localhost on desktop and a LAN address on mobile). When the
  // session is known to have come from this primary connection, the session
  // list is stronger evidence than the configured Helm endpoint.
  if (
    input.session.id !== undefined &&
    input.primarySessionIds?.has(input.session.id) &&
    input.primaryClient?.socket.readyState === 1
  ) {
    return {
      client: input.primaryClient,
      helmKey: input.currentHelmKey,
    };
  }

  return null;
}
