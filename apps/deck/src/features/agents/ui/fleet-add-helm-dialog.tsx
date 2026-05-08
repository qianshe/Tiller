import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/shared/ui";
import { PairingBoxes } from "./pairing-boxes";

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-label="添加 Helm" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加 Helm</DialogTitle>
        </DialogHeader>

        {!readyForPairing ? (
          <form className="grid gap-4" onSubmit={onConnect}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <Label className="grid gap-2 sm:col-span-2">
                <span>Helm 名称</span>
                <Input
                  value={helmName}
                  onChange={(event) => setHelmName(event.target.value)}
                  placeholder="本地 Helm"
                  autoFocus
                />
              </Label>
              <Label className="grid gap-2">
                <span>Helm 地址</span>
                <Input
                  value={helmHost}
                  onChange={(event) => setHelmHost(event.target.value)}
                  placeholder={defaultHost}
                />
              </Label>
              <Label className="grid gap-2">
                <span>端口</span>
                <Input
                  value={helmPort}
                  onChange={(event) =>
                    setHelmPort(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder={defaultPort}
                />
              </Label>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={stage === "connecting"}>
                {stage === "connecting" ? "连接中..." : "连接 Helm"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form className="grid gap-5" onSubmit={onSubmitPairingCode}>
            <strong className="text-base font-semibold text-foreground">输入验证码</strong>

            <PairingBoxes
              refs={pairInputRefs}
              value={pairingCodeInput}
              disabled={pairingState === "waiting" || connection !== "connected"}
              onChange={onUpdatePairingDigit}
              onKeyDown={onPairingKeyDown}
              onPaste={onPastePairingDigits}
            />

            <DialogFooter>
              <Button
                type="button"
                onClick={onSendPairingRequest}
                disabled={
                  pairingCodeInput.length !== 6 ||
                  pairingState === "waiting" ||
                  connection !== "connected"
                }
              >
                {pairingState === "waiting" ? "提交中..." : "提交验证码"}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => void reconnect()}
              >
                重新连接
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
