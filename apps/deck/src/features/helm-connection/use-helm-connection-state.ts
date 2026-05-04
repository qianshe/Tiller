import { useRef, useState } from "react";
import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";

export type HelmInventoryBucket = {
  helms?: HelmSummary[];
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  statuses: Record<string, SessionStatus>;
  trustedDevices: TrustedDeviceSummary[];
};

export type DebugTrace = {
  connectClicks: number;
  pairClicks: number;
  requestsSent: number;
  lastRequestType: string;
};

type HelmEndpoint = {
  host: string;
  port: string;
};

export function useHelmConnectionState({
  defaultHelmEndpoint,
  fixtureConnected,
}: {
  defaultHelmEndpoint: HelmEndpoint;
  fixtureConnected: boolean;
}) {
  const autoConnectAttemptRef = useRef<string | null>(null);
  const manualDisconnectRef = useRef<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(
    fixtureConnected ? "connected" : "disconnected",
  );
  const [pairingState, setPairingState] = useState<PairingState>(
    fixtureConnected ? "paired" : "idle",
  );
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  const [pairingFeedback, setPairingFeedback] = useState("");
  const [connectFeedback, setConnectFeedback] = useState("");
  const [daemonHost, setDaemonHost] = useState(() => defaultHelmEndpoint.host);
  const [daemonPort, setDaemonPort] = useState(() => defaultHelmEndpoint.port);
  const [debugTrace, setDebugTrace] = useState<DebugTrace>({
    connectClicks: 0,
    pairClicks: 0,
    requestsSent: 0,
    lastRequestType: "none",
  });

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
