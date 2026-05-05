import type { FormEvent, MutableRefObject } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { DebugTrace, PairingState } from "../../../store/facade";
import {
  handlePairingKeyDown as handlePairingKeyDownImpl,
  pastePairingDigits as pastePairingDigitsImpl,
  sendPairingRequest as sendPairingRequestImpl,
  submitPairingCode as submitPairingCodeImpl,
  updatePairingDigit as updatePairingDigitImpl,
} from "../actions/code-actions";

type UseCodeActionsOptions = {
  socketRef: MutableRefObject<WebSocket | null>;
  pairingCodeInput: string;
  setPairingCodeInput: (value: string) => void;
  pairInputRefs: MutableRefObject<Array<HTMLInputElement | null>>;
  pairingState: PairingState;
  setPairingState: (state: PairingState) => void;
  setPairingFeedback: (value: string) => void;
  setDebugTrace: (updater: (current: DebugTrace) => DebugTrace) => void;
  dispatch: (socket: WebSocket, payload: ClientToHelm) => void;
  requestCounter: MutableRefObject<number>;
  deckDeviceId: string;
  deckDeviceName: string;
};

/**
 * Binds pairing code UI callbacks to the shared pairing action functions.
 */
export function useCodeActions({
  socketRef,
  pairingCodeInput,
  setPairingCodeInput,
  pairInputRefs,
  pairingState,
  setPairingState,
  setPairingFeedback,
  setDebugTrace,
  dispatch,
  requestCounter,
  deckDeviceId,
  deckDeviceName,
}: UseCodeActionsOptions) {
  function updatePairingDigit(index: number, rawValue: string) {
    updatePairingDigitImpl(index, rawValue, {
      pairingCodeInput,
      setPairingCodeInput,
      pairInputRefs,
      pairingState,
      setPairingState,
    });
  }

  function pastePairingDigits(startIndex: number, rawValue: string) {
    pastePairingDigitsImpl(startIndex, rawValue, {
      pairingCodeInput,
      setPairingCodeInput,
      pairInputRefs,
      pairingState,
      setPairingState,
    });
  }

  function handlePairingKeyDown(index: number, key: string) {
    handlePairingKeyDownImpl(index, key, { pairingCodeInput, pairInputRefs });
  }

  function sendPairingRequest() {
    sendPairingRequestImpl({
      socketRef,
      pairingCodeInput,
      setPairingFeedback,
      setDebugTrace,
      dispatch,
      requestCounter,
      deckDeviceId,
      deckDeviceName,
      setPairingState,
    });
  }

  function submitPairingCode(event: FormEvent<HTMLFormElement>) {
    submitPairingCodeImpl(event, sendPairingRequest);
  }

  return {
    updatePairingDigit,
    pastePairingDigits,
    handlePairingKeyDown,
    sendPairingRequest,
    submitPairingCode,
  };
}
