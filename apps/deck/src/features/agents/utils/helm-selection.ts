import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import {
  daemonProfileKey,
  type DaemonProfile,
} from "../../helm-connection/daemon-profiles";
import {
  dedupeHelmCards,
  resolveHelmConnectionState,
  slugify,
} from "./fleet-helpers";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type HelmInventoryBucket = {
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  trustedDevices: TrustedDeviceSummary[];
};

type ResolveHelmSelectionOptions = {
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  isEmbeddedHelmDeck: boolean;
  daemonProfiles: DaemonProfile[];
  selectedHelmKey: string;
  connection: ConnectionState;
  helmConnectionStates: Record<string, ConnectionState>;
  helmInventories: Record<string, HelmInventoryBucket>;
  trustedDevices: TrustedDeviceSummary[];
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  workspaces: WorkspaceSummary[];
  configuredHelms: HelmSummary[];
  socket: WebSocket | null;
  helmSockets: Map<string, WebSocket>;
};

export function resolveHelmSelection({
  daemonHost,
  daemonPort,
  defaultDaemonHost,
  defaultDaemonPort,
  isEmbeddedHelmDeck,
  daemonProfiles,
  selectedHelmKey,
  connection,
  helmConnectionStates,
  helmInventories,
  trustedDevices,
  projects,
  agents,
  workspaces,
  configuredHelms,
  socket,
  helmSockets,
}: ResolveHelmSelectionOptions) {
  const currentHelmKey = daemonProfileKey(
    daemonHost.trim() || defaultDaemonHost,
    daemonPort.trim() || defaultDaemonPort,
  );
  const currentSavedHelmProfile = daemonProfiles.find(
    (profile) =>
      daemonProfileKey(profile.host, profile.port) === currentHelmKey,
  );
  const additionalHelmCards = isEmbeddedHelmDeck
    ? []
    : daemonProfiles
        .filter(
          (profile) =>
            daemonProfileKey(profile.host, profile.port) !== currentHelmKey,
        )
        .map((profile) => ({
          key: daemonProfileKey(profile.host, profile.port),
          name: profile.name,
          host: profile.host,
          port: profile.port,
          isCurrent: false,
          profile,
        }));
  const helmCards = dedupeHelmCards([
    {
      key: currentHelmKey,
      name: currentSavedHelmProfile?.name || "Local Helm",
      host: daemonHost.trim() || defaultDaemonHost,
      port: daemonPort.trim() || defaultDaemonPort,
      isCurrent: true,
      profile: null as DaemonProfile | null,
    },
    ...additionalHelmCards,
  ]);
  const selectedKey = selectedHelmKey || currentHelmKey;
  const selectedHelm =
    helmCards.find((helm) => helm.key === selectedKey) ?? helmCards[0];
  if (!selectedHelm) {
    return null;
  }

  const selectedHelmIsCurrent = selectedHelm.key === currentHelmKey;
  const selectedHelmConnection = resolveHelmConnectionState(
    selectedHelm,
    currentHelmKey,
    connection,
    helmConnectionStates,
  );
  const selectedHelmInventory = helmInventories[selectedHelm.key];
  const selectedHelmSummary = configuredHelms.find(
    (helm) =>
      helm.host === selectedHelm.host && String(helm.port) === selectedHelm.port,
  );
  const selectedHelmSavedProfile =
    daemonProfiles.find(
      (profile) =>
        daemonProfileKey(profile.host, profile.port) === selectedHelm.key,
    ) ?? null;

  return {
    currentHelmKey,
    helmCards,
    selectedHelm,
    selectedHelmAgents: selectedHelmIsCurrent
      ? agents
      : (selectedHelmInventory?.agents ?? []),
    selectedHelmConnection,
    selectedHelmId:
      selectedHelmSummary?.id ?? slugify(selectedHelm.name || selectedHelm.key),
    selectedHelmIsConnected: selectedHelmConnection === "connected",
    selectedHelmIsCurrent,
    selectedHelmProjects: selectedHelmIsCurrent
      ? projects
      : (selectedHelmInventory?.projects ?? []),
    selectedHelmSavedProfile,
    selectedHelmSocket: selectedHelmIsCurrent
      ? socket
      : (helmSockets.get(selectedHelm.key) ?? null),
    selectedHelmTrustedDevices: selectedHelmIsCurrent
      ? trustedDevices
      : (selectedHelmInventory?.trustedDevices ?? []),
    selectedHelmWorkspaces: selectedHelmIsCurrent
      ? workspaces
      : (selectedHelmInventory?.workspaces ?? []),
  };
}
