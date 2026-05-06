import assert from "node:assert/strict";
import test from "node:test";
import type { MutableRefObject } from "react";
import {
  handlePairingKeyDown,
  pastePairingDigits,
  sendPairingRequest,
  updatePairingDigit,
} from "./code-actions.js";

function inputRef() {
  return {
    focused: false,
    focus() {
      this.focused = true;
    },
  };
}

test("pairing digit input normalizes a single character and advances focus", () => {
  const refs = [inputRef(), inputRef()] as Array<HTMLInputElement & { focused: boolean }>;
  let value = "";
  let state = "rejected" as const;

  updatePairingDigit(0, " z ", {
    pairingCodeInput: value,
    setPairingCodeInput: (next) => {
      value = next;
    },
    pairInputRefs: { current: refs } as unknown as MutableRefObject<
      Array<HTMLInputElement | null>
    >,
    pairingState: state,
    setPairingState: (next) => {
      state = next as typeof state;
    },
  });

  assert.equal(value, "Z");
  assert.equal(refs[1]?.focused, true);
  assert.equal(state, "input");
});

test("pairing paste fills from the start index", () => {
  const refs = Array.from({ length: 6 }, () => inputRef()) as Array<
    HTMLInputElement & { focused: boolean }
  >;
  let value = "AB";

  pastePairingDigits(2, "c d e", {
    pairingCodeInput: value,
    setPairingCodeInput: (next) => {
      value = next;
    },
    pairInputRefs: { current: refs } as unknown as MutableRefObject<
      Array<HTMLInputElement | null>
    >,
    pairingState: "input",
    setPairingState: () => undefined,
  });

  assert.equal(value, "ABCDE");
  assert.equal(refs[5]?.focused, true);
});

test("pairing backspace moves focus to the previous empty input", () => {
  const refs = [inputRef(), inputRef()] as Array<HTMLInputElement & { focused: boolean }>;

  handlePairingKeyDown(1, "Backspace", {
    pairingCodeInput: "A",
    pairInputRefs: { current: refs } as unknown as MutableRefObject<
      Array<HTMLInputElement | null>
    >,
  });

  assert.equal(refs[0]?.focused, true);
});

test("sendPairingRequest sends a device.pair payload for six-character codes", () => {
  const socket = { readyState: WebSocket.OPEN } as WebSocket;
  const client = { socket };
  let feedback = "";
  const sent: Array<{ method: string; params: unknown }> = [];

  sendPairingRequest({
    rpcClientRef: { current: client } as any,
    pairingCodeInput: "abc123",
    setPairingFeedback: (value) => {
      feedback = value;
    },
    setDebugTrace: (updater) => {
      updater({ connectClicks: 0, pairClicks: 0, requestsSent: 0, lastRequestType: "none" });
    },
    dispatch: async (_client, method, params) => {
      sent.push({ method, params });
    },
    deckDeviceId: "device-1",
    deckDeviceName: "Deck",
    setPairingState: () => undefined,
  });

  assert.equal(feedback, "正在发送配对请求：ABC123...");
  assert.equal(sent[0]?.method, "device/pair");
});
