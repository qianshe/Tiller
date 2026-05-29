import { WebSocket } from "ws";
import {
  decodeMessage,
  encodeMessage,
  ErrorCode,
  isJsonRpcRequest,
  rpcError,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcSuccess,
} from "@tiller/sync-protocol";

export type AuthenticatedSocketRegistry = {
  add(record: {
    socketId: string;
    socket: WebSocket;
    deviceId: string;
    authenticatedAt: string;
    lastSeenAt: string;
  }): void;
};

export type PairingCodeState = {
  getCode(): string | null | undefined;
  reset(): void;
};

export type SocketTrustedDeviceStore = {
  authenticate(input: { deviceId: string; token: string }): {
    ok: boolean;
    requiresPairing?: boolean;
    trustedUntil?: string;
    message: string;
  };
  issue(input: { deviceId: string; deviceName: string; clientKind?: string }): {
    token: string;
    record: {
      expiresAt: string;
      deviceName: string;
    };
  };
};

export type SocketAuthenticatorOptions = {
  authMode: string;
  authenticatedSockets: AuthenticatedSocketRegistry;
  getSocketId: (socket: WebSocket) => string;
  trustedDeviceStore: SocketTrustedDeviceStore;
  pairingState: PairingCodeState;
  showPairingCode: () => void;
  attachRpcConnection: (socket: WebSocket) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

export function createSocketAuthenticator(options: SocketAuthenticatorOptions) {
  const {
    authMode,
    authenticatedSockets,
    getSocketId,
    trustedDeviceStore,
    pairingState,
    showPairingCode,
    attachRpcConnection,
    logInfo,
    logError,
  } = options;

  function sendSuccess(socket: WebSocket, id: JsonRpcId, result: unknown) {
    send(socket, { jsonrpc: "2.0", id, result });
  }

  function sendFailure(socket: WebSocket, id: JsonRpcId | null, error: JsonRpcFailure["error"]) {
    send(socket, { jsonrpc: "2.0", id, error });
  }

  function send(socket: WebSocket, message: JsonRpcSuccess | JsonRpcFailure) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encodeMessage(message));
    }
  }

  function authenticateSocket(socket: WebSocket, deviceId: string) {
    const socketId = getSocketId(socket);
    authenticatedSockets.add({
      socketId,
      socket,
      deviceId,
      authenticatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    socket.removeAllListeners("message");
    attachRpcConnection(socket);
  }

  function handlePairing(
    socket: WebSocket,
    id: JsonRpcId,
    params: { pairingCode?: string; deviceId?: string; deviceName?: string; clientKind?: string },
  ) {
    const activeCode = pairingState.getCode();
    if (!params.pairingCode || !params.deviceId || !params.deviceName) {
      sendFailure(socket, id, rpcError(ErrorCode.InvalidParams, "Invalid device/pair params"));
      return false;
    }
    if (!activeCode || params.pairingCode.toUpperCase() !== activeCode) {
      sendSuccess(socket, id, {
        ok: false,
        message: "Invalid pairing code.",
      });
      return false;
    }

    const issued = trustedDeviceStore.issue({
      deviceId: params.deviceId,
      deviceName: params.deviceName,
      clientKind: params.clientKind,
    });
    pairingState.reset();
    authenticateSocket(socket, params.deviceId);
    logInfo(`[tiller] Beacon paired device=${params.deviceId} (${params.deviceName}) ✓`);
    sendSuccess(socket, id, {
      ok: true,
      token: issued.token,
      trustedUntil: issued.record.expiresAt,
      deviceName: issued.record.deviceName,
      message: "Beacon anchored successfully.",
    });
    return true;
  }

  return function beginAuthenticationFlow(socket: WebSocket) {
    if (authMode === "none") {
      authenticateSocket(socket, "local-deck");
      logInfo("[tiller] personal auth disabled; client accepted");
      return;
    }

    let authenticated = false;
    const pairingPromptTimer = setTimeout(() => {
      if (!authenticated && socket.readyState === WebSocket.OPEN) {
        showPairingCode();
      }
    }, 500);

    socket.on("message", (raw) => {
      if (authenticated) {
        return;
      }

      try {
        const message = decodeMessage(String(raw));
        if (!isJsonRpcRequest(message)) {
          sendFailure(socket, null, rpcError(ErrorCode.InvalidRequest, "Authenticate with device/authenticate or device/pair."));
          return;
        }

        if (message.method === "device/authenticate") {
          const params = message.params as { deviceId?: string; token?: string } | undefined;
          if (!params?.deviceId || !params.token) {
            sendFailure(socket, message.id, rpcError(ErrorCode.InvalidParams, "Invalid device/authenticate params"));
            return;
          }
          const result = trustedDeviceStore.authenticate({
            deviceId: params.deviceId,
            token: params.token,
          });
          if (!result.ok) {
            clearTimeout(pairingPromptTimer);
            showPairingCode();
            sendSuccess(socket, message.id, {
              ok: false,
              requiresPairing: result.requiresPairing,
              message: result.message,
            });
            socket.close();
            return;
          }

          authenticated = true;
          clearTimeout(pairingPromptTimer);
          authenticateSocket(socket, params.deviceId);
          logInfo(`[tiller] Beacon authenticated device=${params.deviceId} ✓`);
          sendSuccess(socket, message.id, {
            ok: true,
            trustedUntil: result.trustedUntil,
            message: result.message,
          });
          return;
        }

        if (message.method === "device/pair") {
          clearTimeout(pairingPromptTimer);
          authenticated = handlePairing(socket, message.id, message.params as any);
          return;
        }

        sendFailure(
          socket,
          message.id,
          rpcError(
            ErrorCode.InvalidRequest,
            "Helm not authenticated yet. Send device/authenticate or device/pair first.",
          ),
        );
      } catch (error) {
        logError(`[tiller] auth message failed: ${error instanceof Error ? error.message : String(error)}`);
        sendFailure(
          socket,
          null,
          error && typeof error === "object" && "code" in error
            ? (error as JsonRpcFailure["error"])
            : rpcError(ErrorCode.ParseError, "Invalid message"),
        );
      }
    });
  };
}
