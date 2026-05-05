import { useMemo } from "react";
import type { HelmSummary } from "@tiller/shared";

import {
  daemonProfileKey,
  type DaemonProfile,
} from "../features/helm-connection/daemon-profiles";
import { normalizeEmbeddedHelmSummaries } from "../features/helm-connection/helm-endpoint";
import {
  daemonProfileToHelmSummary,
  mergeHelmSummariesByEndpoint,
} from "../features/helm-connection/utils/daemon-helpers";

type UseConfiguredHelmsOptions = {
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  daemonProfiles: DaemonProfile[];
  helms: HelmSummary[];
  embedded: boolean;
};

export function useConfiguredHelms({
  daemonHost,
  daemonPort,
  defaultDaemonHost,
  defaultDaemonPort,
  daemonProfiles,
  helms,
  embedded,
}: UseConfiguredHelmsOptions) {
  return useMemo(() => {
    const currentHost = daemonHost.trim() || defaultDaemonHost;
    const currentPort = daemonPort.trim() || defaultDaemonPort;
    const currentKey = daemonProfileKey(currentHost, currentPort);
    const currentSavedProfile = daemonProfiles.find(
      (profile) => daemonProfileKey(profile.host, profile.port) === currentKey,
    );
    const currentProfile: DaemonProfile = {
      id: currentSavedProfile?.id ?? "current-helm",
      name: currentSavedProfile?.name || "Local Helm",
      host: currentHost,
      port: currentPort,
    };

    return mergeHelmSummariesByEndpoint(
      [currentProfile, ...daemonProfiles]
        .map(daemonProfileToHelmSummary)
        .concat(
          normalizeEmbeddedHelmSummaries({
            embedded,
            host: currentHost,
            port: currentPort,
            helms,
          }),
        ),
    );
  }, [
    daemonHost,
    daemonPort,
    defaultDaemonHost,
    defaultDaemonPort,
    daemonProfiles,
    helms,
    embedded,
  ]);
}
