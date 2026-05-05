import { WebSocket } from "ws";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";

type AuthenticatedSocketRegistry = {
  add(record: {
    socketId: string;
    socket: WebSocket;
    deviceId: string;
    authenticatedAt: string;
    lastSeenAt: string;
  }): void;
};

type PairingState = {
  getCode(): string | null | undefined;
  reset(): void;
};

type TrustedDeviceStore = {
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

type SocketAuthenticatorOptions = {
  authMode: string;
  authenticatedSockets: AuthenticatedSocketRegistry;
  getSocketId: (socket: WebSocket) => string;
  trustedDeviceStore: TrustedDeviceStore;
  pairingState: PairingState;
  showPairingCode: () => void;
  reply: (socket: WebSocket, message: HelmToClient) => void;
  handleMessage: (socket: WebSocket, payload: ClientToHelm) => Promise<void>;
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
    reply,
    handleMessage,
    logInfo,
    logError,
  } = options;

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
    socket.on("message", (raw) => {
      let payload: ClientToHelm;
      try {
        payload = JSON.parse(String(raw)) as ClientToHelm;
      } catch (error) {
        reply(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "Invalid message",
        });
        return;
      }

      void handleMessage(socket, payload).catch((error) => {
        logError(
          `[tiller] message handler failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
        reply(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "Message handler failed",
        });
      });
    });
  }

  function handlePairing(socket: WebSocket, payload: Extract<ClientToHelm, { type: "device.pair" }>) {
    const activeCode = pairingState.getCode();
    if (!activeCode || payload.pairingCode.toUpperCase() !== activeCode) {
      reply(socket, {
        type: "device.pair.result",
        requestId: payload.requestId,
        ok: false,
        message: "Invalid pairing code.",
      });
      return;
    }

    const issued = trustedDeviceStore.issue({
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      clientKind: payload.clientKind,
    });
    pairingState.reset();
    authenticateSocket(socket, payload.deviceId);
    logInfo(`[tiller] Beacon paired device=${payload.deviceId} (${payload.deviceName}) ✓`);

    reply(socket, {
      type: "device.pair.result",
      requestId: payload.requestId,
      ok: true,
      token: issued.token,
      trustedUntil: issued.record.expiresAt,
      deviceName: issued.record.deviceName,
      message: "Beacon anchored successfully.",
    });
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
        const payload = JSON.parse(String(raw)) as ClientToHelm;
        if (payload.type === "device.auth") {
          const result = trustedDeviceStore.authenticate({
            deviceId: payload.deviceId,
            token: payload.token,
          });
          if (!result.ok) {
            clearTimeout(pairingPromptTimer);
            showPairingCode();
            reply(socket, {
              type: "device.auth.result",
              requestId: payload.requestId,
              ok: false,
              requiresPairing: result.requiresPairing,
              message: result.message,
            });
            socket.close();
            return;
          }

          authenticated = true;
          clearTimeout(pairingPromptTimer);
          authenticateSocket(socket, payload.deviceId);
          logInfo(`[tiller] Beacon authenticated device=${payload.deviceId} ✓`);
          reply(socket, {
            type: "device.auth.result",
            requestId: payload.requestId,
            ok: true,
            trustedUntil: result.trustedUntil,
            message: result.message,
          });
          return;
        }

        if (payload.type === "device.pair") {
          clearTimeout(pairingPromptTimer);
          handlePairing(socket, payload);
          authenticated = true;
          return;
        }

        reply(socket, {
          type: "error",
          message: "Helm not authenticated yet. Send device.auth or device.pair first.",
        });
      } catch (error) {
        reply(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "Invalid message",
        });
      }
    });
  };
}
