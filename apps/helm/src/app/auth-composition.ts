import type { WebSocket } from "ws";
import {
  createSocketAuthenticator,
  type AuthenticatedSocketRegistry,
  type SocketAuthenticatorOptions,
  type SocketTrustedDeviceStore,
} from "../auth/socket-auth";
import {
  createPairingState as createDefaultPairingState,
  type PairingState,
} from "../state/pairing";

type BeginAuthenticationFlow = (socket: WebSocket) => void;

export type HelmAuthCompositionOptions = {
  authMode: string;
  authenticatedSockets: AuthenticatedSocketRegistry;
  getSocketId: (socket: WebSocket) => string;
  trustedDeviceStore: SocketTrustedDeviceStore;
  showPairingCode: (pairingState: PairingState) => void;
  attachRpcConnection: (socket: WebSocket) => void;
  logInfo: (message: string) => void;
  logDebug: (message: string) => void;
  logError: (message: string) => void;
  createPairingState?: () => PairingState;
  createSocketAuthenticator?: (options: SocketAuthenticatorOptions) => BeginAuthenticationFlow;
};

export type HelmAuthComposition = {
  pairingState: PairingState;
  beginAuthenticationFlow: BeginAuthenticationFlow;
};

export function createHelmAuthComposition(
  options: HelmAuthCompositionOptions,
): HelmAuthComposition {
  const pairingState = (options.createPairingState ?? createDefaultPairingState)();
  const beginAuthenticationFlow = (options.createSocketAuthenticator ?? createSocketAuthenticator)({
    authMode: options.authMode,
    authenticatedSockets: options.authenticatedSockets,
    getSocketId: options.getSocketId,
    trustedDeviceStore: options.trustedDeviceStore,
    pairingState,
    showPairingCode: () => options.showPairingCode(pairingState),
    attachRpcConnection: options.attachRpcConnection,
    logInfo: options.logInfo,
    logDebug: options.logDebug,
    logError: options.logError,
  });

  return {
    pairingState,
    beginAuthenticationFlow,
  };
}
