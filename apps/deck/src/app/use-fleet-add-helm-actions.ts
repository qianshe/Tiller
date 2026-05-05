import type { FormEvent } from "react";
import type { DaemonProfile } from "../features/helm-connection/daemon-profiles";
import type { ConnectToDaemonOptions } from "../features/helm-connection/sockets";

type FleetAddHelmStage = "connect" | "connecting" | "pair";
type MutableRef<T> = { current: T };

type UseFleetAddHelmActionsOptions = {
  fleetAddHelmName: string;
  fleetAddHelmHost: string;
  fleetAddHelmPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  pendingAddHelmProfileRef: MutableRef<DaemonProfile | null>;
  setFleetAddHelmModalOpen: (open: boolean) => void;
  setFleetAddHelmStage: (stage: FleetAddHelmStage) => void;
  setFleetAddHelmName: (name: string) => void;
  setFleetAddHelmHost: (host: string) => void;
  setFleetAddHelmPort: (port: string) => void;
  createDaemonProfile: (
    nameValue: string,
    hostValue: string,
    portValue: string,
  ) => DaemonProfile;
  connectToDaemon: (
    event?: FormEvent<HTMLFormElement>,
    options?: ConnectToDaemonOptions,
  ) => void;
};

export function useFleetAddHelmActions({
  fleetAddHelmName,
  fleetAddHelmHost,
  fleetAddHelmPort,
  defaultDaemonHost,
  defaultDaemonPort,
  pendingAddHelmProfileRef,
  setFleetAddHelmModalOpen,
  setFleetAddHelmStage,
  setFleetAddHelmName,
  setFleetAddHelmHost,
  setFleetAddHelmPort,
  createDaemonProfile,
  connectToDaemon,
}: UseFleetAddHelmActionsOptions) {
  function openFleetAddHelmModal() {
    setFleetAddHelmStage("connect");
    setFleetAddHelmName("");
    setFleetAddHelmHost(defaultDaemonHost);
    setFleetAddHelmPort(defaultDaemonPort);
    pendingAddHelmProfileRef.current = null;
    setFleetAddHelmModalOpen(true);
  }

  function closeFleetAddHelmModal() {
    setFleetAddHelmModalOpen(false);
    setFleetAddHelmStage("connect");
    pendingAddHelmProfileRef.current = null;
  }

  function connectFromFleetAddHelmModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = createDaemonProfile(
      fleetAddHelmName,
      fleetAddHelmHost,
      fleetAddHelmPort,
    );
    pendingAddHelmProfileRef.current = profile;
    setFleetAddHelmStage("connecting");
    void connectToDaemon(undefined, {
      preserveState: true,
      host: profile.host,
      port: profile.port,
      persistEndpoint: false,
    });
  }

  return {
    closeFleetAddHelmModal,
    connectFromFleetAddHelmModal,
    openFleetAddHelmModal,
  };
}
