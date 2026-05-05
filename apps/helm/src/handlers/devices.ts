import type { HelmMessageHandler } from "./context";

export const handleDeviceMessage: HelmMessageHandler = (socket, payload, context) => {
  switch (payload.type) {
    case "device.list":
      context.emit(socket, {
        type: "device.list.result",
        requestId: payload.requestId,
        devices: context.trustedDeviceStore.list().map(context.toTrustedDeviceSummary),
      });
      return true;
    case "device.revoke": {
      const revoked = context.trustedDeviceStore.revoke(payload.deviceId);
      const revokedSockets = context.authenticatedSockets.listForDevice(payload.deviceId);
      const requesterRevoked = revokedSockets.some(
        (record: { socket: unknown }) => record.socket === socket,
      );
      for (const record of revokedSockets) {
        context.authenticatedSockets.remove(record.socketId);
        context.emit(record.socket, {
          type: "device.revoke.result",
          requestId: payload.requestId,
          ok: revoked,
          deviceId: payload.deviceId,
          message: revoked
            ? "This beacon was revoked. Pair again to reconnect."
            : "Beacon not found.",
        });
        record.socket.close();
      }
      if (!requesterRevoked) {
        context.emit(socket, {
          type: "device.revoke.result",
          requestId: payload.requestId,
          ok: revoked,
          deviceId: payload.deviceId,
          message: revoked ? "Beacon revoked." : "Beacon not found.",
        });
      }
      return true;
    }
    default:
      return false;
  }
};
