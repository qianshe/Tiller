import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { SocketAuthenticatorOptions } from "../auth/socket-auth";
import { createPairingState } from "../state/pairing";
import { createHelmAuthComposition } from "./auth-composition";

test("createHelmAuthComposition wires auth dependencies through one app boundary", () => {
  const pairingState = createPairingState({ generate: () => "ABC123" });
  const authenticatedSockets = { add: () => undefined };
  const trustedDeviceStore = {
    authenticate: () => ({ ok: false, requiresPairing: true, message: "pair" }),
    issue: () => ({
      token: "token",
      record: { expiresAt: "2026-05-29T10:00:00.000Z", deviceName: "Deck" },
    }),
  };
  const getSocketId = () => "socket-1";
  const attachRpcConnection = () => undefined;
  const logInfo = () => undefined;
  const logError = () => undefined;
  const beginAuthenticationFlow = () => undefined;
  let capturedOptions: SocketAuthenticatorOptions | undefined;
  let shownCode: string | undefined;

  const composition = createHelmAuthComposition({
    authMode: "device",
    authenticatedSockets,
    getSocketId,
    trustedDeviceStore,
    showPairingCode: (state) => {
      shownCode = state.ensureCode();
    },
    attachRpcConnection,
    logInfo,
    logError,
    createPairingState: () => pairingState,
    createSocketAuthenticator: (options) => {
      capturedOptions = options;
      return beginAuthenticationFlow;
    },
  });

  assert.equal(composition.pairingState, pairingState);
  assert.equal(composition.beginAuthenticationFlow, beginAuthenticationFlow);
  assert.equal(capturedOptions?.authMode, "device");
  assert.equal(capturedOptions?.authenticatedSockets, authenticatedSockets);
  assert.equal(capturedOptions?.getSocketId, getSocketId);
  assert.equal(capturedOptions?.trustedDeviceStore, trustedDeviceStore);
  assert.equal(capturedOptions?.attachRpcConnection, attachRpcConnection);
  assert.equal(capturedOptions?.logInfo, logInfo);
  assert.equal(capturedOptions?.logError, logError);

  capturedOptions?.showPairingCode();

  assert.equal(shownCode, "ABC123");
});

test("server delegates auth and pairing composition to app/auth-composition", () => {
  const serverSource = readFileSync(resolve("src/server.ts"), "utf8");

  assert.match(serverSource, /createHelmAuthComposition/u);
  assert.doesNotMatch(serverSource, /createSocketAuthenticator/u);
  assert.doesNotMatch(serverSource, /createPairingState/u);
});
