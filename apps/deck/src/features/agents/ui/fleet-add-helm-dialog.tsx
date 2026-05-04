import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { PairingBoxes } from "../../../shared/ui/primitives";

type ConnectionState = "connecting" | "connected" | "disconnected";
type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";

type FleetAddHelmDialogProps = {
  stage: "connect" | "connecting" | "pair";
  connection: ConnectionState;
  onClose: () => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  helmName: string;
  setHelmName: Dispatch<SetStateAction<string>>;
  helmHost: string;
  setHelmHost: Dispatch<SetStateAction<string>>;
  helmPort: string;
  setHelmPort: Dispatch<SetStateAction<string>>;
  defaultHost: string;
  defaultPort: string;
  onSubmitPairingCode: (event: FormEvent<HTMLFormElement>) => void;
  pairInputRefs: MutableRefObject<Array<HTMLInputElement | null>>;
  pairingCodeInput: string;
  pairingState: PairingState;
  onUpdatePairingDigit: (index: number, rawValue: string) => void;
  onPairingKeyDown: (index: number, key: string) => void;
  onPastePairingDigits: (startIndex: number, rawValue: string) => void;
  onSendPairingRequest: () => void;
  reconnect: () => Promise<void> | void;
};

export function FleetAddHelmDialog({
  stage,
  connection,
  onClose,
  onConnect,
  helmName,
  setHelmName,
  helmHost,
  setHelmHost,
  helmPort,
  setHelmPort,
  defaultHost,
  defaultPort,
  onSubmitPairingCode,
  pairInputRefs,
  pairingCodeInput,
  pairingState,
  onUpdatePairingDigit,
  onPairingKeyDown,
  onPastePairingDigits,
  onSendPairingRequest,
  reconnect,
}: FleetAddHelmDialogProps) {
  const readyForPairing = stage === "pair";

  return (
    <div className="fleet-modal-backdrop" role="presentation">
      <section
        className="card surface-card fleet-add-helm-modal fleet-add-helm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="添加 Helm"
      >
        <div className="fleet-dialog-head fleet-dialog-head-simple">
          <h3>添加 Helm</h3>
          <button
            className="secondary fleet-dialog-close"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="fleet-dialog-body fleet-dialog-body-single">
          {!readyForPairing ? (
            <form
              className="fleet-dialog-card fleet-connect-card"
              onSubmit={onConnect}
            >
              <div className="fleet-connect-grid">
                <label className="fleet-field-full">
                  <span>Helm 名称</span>
                  <input
                    value={helmName}
                    onChange={(event) => setHelmName(event.target.value)}
                    placeholder="本地 Helm"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Helm 地址</span>
                  <input
                    value={helmHost}
                    onChange={(event) => setHelmHost(event.target.value)}
                    placeholder={defaultHost}
                  />
                </label>
                <label>
                  <span>端口</span>
                  <input
                    value={helmPort}
                    onChange={(event) =>
                      setHelmPort(event.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder={defaultPort}
                  />
                </label>
              </div>

              <div className="section-actions fleet-modal-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={stage === "connecting"}
                >
                  {stage === "connecting" ? "连接中..." : "连接 Helm"}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="fleet-dialog-card fleet-pair-card"
              onSubmit={onSubmitPairingCode}
            >
              <strong className="fleet-pair-title">输入验证码</strong>

              <PairingBoxes
                refs={pairInputRefs}
                value={pairingCodeInput}
                disabled={pairingState === "waiting" || connection !== "connected"}
                onChange={onUpdatePairingDigit}
                onKeyDown={onPairingKeyDown}
                onPaste={onPastePairingDigits}
              />

              <div className="section-actions pairing-actions fleet-pair-actions">
                <button
                  className="primary"
                  type="button"
                  onClick={onSendPairingRequest}
                  disabled={
                    pairingCodeInput.length !== 6 ||
                    pairingState === "waiting" ||
                    connection !== "connected"
                  }
                >
                  {pairingState === "waiting" ? "提交中..." : "提交验证码"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void reconnect()}
                >
                  重新连接
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
