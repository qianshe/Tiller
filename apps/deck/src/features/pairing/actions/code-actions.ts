import type { FormEvent, MutableRefObject } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { DebugTrace, PairingState } from "../../../store/facade";
import { nextRequestId } from "../../helm-connection/facade";

type DispatchToHelm = (socket: WebSocket, payload: ClientToHelm) => void;
type PairInputRefs = MutableRefObject<Array<HTMLInputElement | null>>;

type PairingInputContext = {
  pairingCodeInput: string;
  setPairingCodeInput: (value: string) => void;
  pairInputRefs: PairInputRefs;
  pairingState: PairingState;
  setPairingState: (state: PairingState) => void;
};

type PairingRequestContext = {
  socketRef: MutableRefObject<WebSocket | null>;
  pairingCodeInput: string;
  setPairingFeedback: (value: string) => void;
  setDebugTrace: (updater: (current: DebugTrace) => DebugTrace) => void;
  dispatch: DispatchToHelm;
  requestCounter: MutableRefObject<number>;
  deckDeviceId: string;
  deckDeviceName: string;
  setPairingState: (state: PairingState) => void;
};

export function updatePairingDigit(
  index: number,
  rawValue: string,
  context: PairingInputContext,
) {
  const { pairingCodeInput, setPairingCodeInput, pairInputRefs, pairingState, setPairingState } =
    context;
  const nextChar = rawValue
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-1);
  const chars = pairingCodeInput.padEnd(6, " ").split("");
  chars[index] = nextChar || " ";
  const nextValue = chars.join("").trimEnd();
  setPairingCodeInput(nextValue);
  if (nextChar && index < 5) {
    pairInputRefs.current[index + 1]?.focus();
  }
  if (pairingState === "rejected") {
    setPairingState("input");
  }
}

export function pastePairingDigits(
  startIndex: number,
  rawValue: string,
  context: PairingInputContext,
) {
  const { pairingCodeInput, setPairingCodeInput, pairInputRefs, pairingState, setPairingState } =
    context;
  const charsOnly = rawValue
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6 - startIndex);
  if (!charsOnly) {
    return;
  }

  const chars = pairingCodeInput.padEnd(6, " ").split("");
  for (let offset = 0; offset < charsOnly.length; offset += 1) {
    chars[startIndex + offset] = charsOnly[offset] ?? " ";
  }
  setPairingCodeInput(chars.join("").trimEnd());
  const focusIndex = Math.min(startIndex + charsOnly.length, 5);
  pairInputRefs.current[focusIndex]?.focus();
  if (pairingState === "rejected") {
    setPairingState("input");
  }
}

export function handlePairingKeyDown(
  index: number,
  key: string,
  context: Pick<PairingInputContext, "pairingCodeInput" | "pairInputRefs">,
) {
  const { pairingCodeInput, pairInputRefs } = context;
  if (key === "Backspace" && !pairingCodeInput[index] && index > 0) {
    pairInputRefs.current[index - 1]?.focus();
  }
}

export function sendPairingRequest(context: PairingRequestContext) {
  const {
    socketRef,
    pairingCodeInput,
    setPairingFeedback,
    setDebugTrace,
    dispatch,
    requestCounter,
    deckDeviceId,
    deckDeviceName,
    setPairingState,
  } = context;

  const socket = socketRef.current;
  const normalizedCode = pairingCodeInput.trim().toUpperCase();
  if (
    !socket ||
    normalizedCode.length !== 6 ||
    socket.readyState !== WebSocket.OPEN
  ) {
    setPairingFeedback(
      `无法发送配对请求，socket=${socket ? socket.readyState : "null"}`,
    );
    return;
  }

  setDebugTrace((current) => ({
    ...current,
    pairClicks: current.pairClicks + 1,
  }));
  setPairingFeedback(`正在发送配对请求：${normalizedCode}...`);
  dispatch(socket, {
    type: "device.pair",
    requestId: nextRequestId(requestCounter),
    pairingCode: normalizedCode,
    deviceId: deckDeviceId,
    deviceName: deckDeviceName,
    clientKind: "web",
  });
  setPairingState("waiting");
}

export function submitPairingCode(
  event: FormEvent<HTMLFormElement>,
  sendPairingRequest: () => void,
) {
  event.preventDefault();
  sendPairingRequest();
}
