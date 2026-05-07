import type { MutableRefObject } from "react";
import { Fragment } from "react";
import { cn } from "@/shared/utils/cn";

type PairingBoxesProps = {
  refs: MutableRefObject<Array<HTMLInputElement | null>>;
  value: string;
  disabled: boolean;
  onChange: (index: number, value: string) => void;
  onKeyDown: (index: number, key: string) => void;
  onPaste: (index: number, value: string) => void;
};

export function PairingBoxes({
  refs,
  value,
  disabled,
  onChange,
  onKeyDown,
  onPaste,
}: PairingBoxesProps) {
  const chars = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

  return (
    <div
      className="pairing-boxes pairing-boxes-grouped grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 max-[520px]:gap-1.5"
      aria-label="6 位验证码，按两位一组输入"
    >
      {[0, 2, 4].map((startIndex, groupIndex) => (
        <Fragment key={startIndex}>
          {groupIndex > 0 ? (
            <span
              className="pairing-separator select-none text-xl font-black leading-none text-muted-foreground"
              aria-hidden="true"
            >
              -
            </span>
          ) : null}
          <div className="pairing-box-group grid grid-cols-2 gap-2.5 max-[520px]:gap-1.5">
            {chars.slice(startIndex, startIndex + 2).map((char, offset) => {
              const index = startIndex + offset;
              return (
                <input
                  key={index}
                  ref={(element) => {
                    refs.current[index] = element;
                  }}
                  className={cn(
                    "pairing-box min-h-14 rounded-md border border-border-ghost bg-surface text-center text-xl font-bold tracking-[0.08em] text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    "dark:bg-surface-sunken",
                  )}
                  value={char}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  maxLength={1}
                  disabled={disabled}
                  onChange={(event) => onChange(index, event.target.value)}
                  onKeyDown={(event) => onKeyDown(index, event.key)}
                  onPaste={(event) => {
                    event.preventDefault();
                    onPaste(index, event.clipboardData.getData("text"));
                  }}
                />
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
