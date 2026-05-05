import { useEffect, useRef } from "react";
import { useDeckStore } from "../../../store";
import { readTrustedDeviceCache } from "../../auth/beacon-cache";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../helm-endpoint";

type HelmEndpoint = {
  host: string;
  port: string;
};

export function useHelmConnection({
  defaultHelmEndpoint,
  fixtureConnected,
}: {
  defaultHelmEndpoint: HelmEndpoint;
  fixtureConnected: boolean;
}) {
  const autoConnectAttemptRef = useRef<string | null>(null);
  const manualDisconnectRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const connection = useDeckStore((state) => state.connection);
  const setConnection = useDeckStore((state) => state.setConnection);
  const pairingState = useDeckStore((state) => state.pairingState);
  const setPairingState = useDeckStore((state) => state.setPairingState);
  const pairingCodeInput = useDeckStore((state) => state.pairingCodeInput);
  const setPairingCodeInput = useDeckStore((state) => state.setPairingCodeInput);
  const pairingFeedback = useDeckStore((state) => state.pairingFeedback);
  const setPairingFeedback = useDeckStore((state) => state.setPairingFeedback);
  const connectFeedback = useDeckStore((state) => state.connectFeedback);
  const setConnectFeedback = useDeckStore((state) => state.setConnectFeedback);
  const daemonHost = useDeckStore((state) => state.daemonHost);
  const setDaemonHost = useDeckStore((state) => state.setDaemonHost);
  const daemonPort = useDeckStore((state) => state.daemonPort);
  const setDaemonPort = useDeckStore((state) => state.setDaemonPort);
  const debugTrace = useDeckStore((state) => state.debugTrace);
  const setDebugTrace = useDeckStore((state) => state.setDebugTrace);
  const setEndpoint = useDeckStore((state) => state.setEndpoint);
  const setTrustedDevice = useDeckStore((state) => state.setTrustedDevice);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    setEndpoint(defaultHelmEndpoint);
    setConnection(fixtureConnected ? "connected" : "disconnected");
    setPairingState(fixtureConnected ? "paired" : "idle");
    setTrustedDevice(
      readTrustedDeviceCache(
        window.localStorage,
        window.localStorage.getItem(DAEMON_HOST_KEY) ?? defaultHelmEndpoint.host,
        window.localStorage.getItem(DAEMON_PORT_KEY) ?? defaultHelmEndpoint.port,
      ),
    );
  }, [
    defaultHelmEndpoint,
    fixtureConnected,
    setConnection,
    setEndpoint,
    setPairingState,
    setTrustedDevice,
  ]);

  return {
    autoConnectAttemptRef,
    manualDisconnectRef,
    connection,
    setConnection,
    pairingState,
    setPairingState,
    pairingCodeInput,
    setPairingCodeInput,
    pairingFeedback,
    setPairingFeedback,
    connectFeedback,
    setConnectFeedback,
    daemonHost,
    setDaemonHost,
    daemonPort,
    setDaemonPort,
    debugTrace,
    setDebugTrace,
  };
}
