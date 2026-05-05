// @ts-nocheck
import type { FormEvent } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { DaemonProfile } from "../daemon-profiles";
import type { ConnectionState } from "../../../store/slices/connection-slice";
import type { HelmInventoryBucket } from "../../../store/slices/helms-slice";
import { readTrustedDeviceCache } from "../../auth/beacon-cache";
import {
  connectHelmSocket as connectHelmSocketImpl,
  connectToDaemon as connectToDaemonImpl,
  type ConnectToDaemonOptions,
} from "../sockets";
import {
  dispatchWithTrace,
  nextRequestId,
  requestInitialSync as requestInitialSyncImpl,
} from "../request-dispatch";
import { DEFAULT_SESSION_PAGE_LIMIT } from "../../mission/config";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
} from "../../../shared/config/deck-runtime";

export function createSocketController(
  source: any,
  handleServerEvent: (payload: any, sourceHelmKey?: string) => void,
) {
  const {
    setSessionHistoryState,
    setHelmConnection,
    applyHelmInventory,
    helmSocketRefs,
    setDaemonProfileMessage,
    requestCounter,
    primaryHelmKeyRef,
    manualDisconnectRef,
    socketRef,
    setSessions,
    setStatuses,
    setMessages,
    setPermissionRequests,
    setOutputs,
    toolCallsRef,
    setToolCalls,
    setDiffs,
    setSessionConfigOptions,
    setTrustedDevices,
    setActiveSessionId,
    setSelectedProjectId,
    setResumeFeedback,
    setDebugTrace,
    setConnection,
    setConnectFeedback,
    copy,
    setPairingState,
    setPairingCodeInput,
    setPairingFeedback,
    pairingState,
    setTrustedDevice,
    lastFilesScopeKeyRef,
    daemonHost,
    daemonPort,
  } = source;

  function dispatch(socket: WebSocket, payload: ClientToHelm) {
    dispatchWithTrace(socket, payload, setDebugTrace);
  }

  function requestInitialSync(socket: WebSocket) {
    requestInitialSyncImpl(socket, {
      dispatch,
      requestCounter,
      setSessionHistoryState,
      sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
    });
  }

  function setHelmConnectionState(helmKey: string, state: ConnectionState) {
    setHelmConnection(helmKey, state);
  }

  function updateHelmInventory(
    helmKey: string,
    patch: Partial<HelmInventoryBucket>,
  ) {
    applyHelmInventory(helmKey, patch);
  }

  function connectHelmSocket(profile: DaemonProfile) {
    connectHelmSocketImpl(profile, {
      embedded: import.meta.env.VITE_TILLER_EMBEDDED_HELM === "true",
      location: window.location,
      helmSocketRefs,
      setHelmConnectionState,
      setDaemonProfileMessage,
      readTrustedDeviceCache,
      requestInitialSync,
      dispatch,
      nextRequestId,
      requestCounter,
      handleServerEvent,
    });
  }

  function connectToDaemon(
    event?: FormEvent<HTMLFormElement>,
    options?: ConnectToDaemonOptions,
  ) {
    connectToDaemonImpl(event, options, {
      embedded: import.meta.env.VITE_TILLER_EMBEDDED_HELM === "true",
      location: window.location,
      daemonHost,
      daemonPort,
      defaultDaemonHost: DEFAULT_DAEMON_HOST,
      defaultDaemonPort: DEFAULT_DAEMON_PORT,
      primaryHelmKeyRef,
      manualDisconnectRef,
      socketRef,
      setSessions,
      setStatuses,
      setMessages,
      setPermissionRequests,
      setOutputs,
      toolCallsRef,
      setToolCalls,
      setDiffs,
      setSessionConfigOptions,
      setTrustedDevices,
      setActiveSessionId,
      setSelectedProjectId,
      setResumeFeedback,
      setDebugTrace,
      setHelmConnectionState,
      setConnection,
      setConnectFeedback,
      copy,
      setPairingState,
      setPairingCodeInput,
      setPairingFeedback,
      pairingState,
      setTrustedDevice,
      readTrustedDeviceCache,
      dispatch,
      nextRequestId,
      requestCounter,
      requestInitialSync,
      lastFilesScopeKeyRef,
      handleServerEvent,
    });
  }

  return {
    connectHelmSocket,
    connectToDaemon,
    dispatch,
    requestInitialSync,
    setHelmConnectionState,
    updateHelmInventory,
  };
}
