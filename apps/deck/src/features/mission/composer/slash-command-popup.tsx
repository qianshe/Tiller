import { useEffect, useRef } from "react";
import type { AvailableCommand, AvailableCommandKind } from "@tiller/shared";
import { formatSlashCommandLabel } from "../hooks/slash-commands";

type SlashCommandPopupProps = {
  commands: AvailableCommand[];
  selectedIndex: number;
  onSelect: (cmd: AvailableCommand) => void;
  onHover: (index: number) => void;
};

export function SlashCommandPopup({
  commands,
  selectedIndex,
  onSelect,
  onHover,
}: SlashCommandPopupProps) {
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedOptionRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedIndex, commands.length]);

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-2 grid w-[min(360px,calc(100vw-2rem))] max-h-80 overflow-y-auto rounded-xl border border-border-ghost bg-surface-elevated p-1.5 text-sm text-foreground shadow-ambient"
      role="listbox"
    >
      {commands.length === 0 ? (
        <div className="grid gap-1 rounded-lg px-3 py-2 text-muted-foreground">
          <span className="font-semibold text-foreground">暂无可用命令</span>
          <span className="text-xs">当前 ACP agent 未上报 slash commands。</span>
        </div>
      ) : null}
      {commands.map((cmd, index) => {
        const selected = index === selectedIndex;
        const commandLabel = formatSlashCommandLabel(cmd);
        const description = cmd.description ?? cmd.input?.hint;
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={selected}
            aria-label={commandLabel}
            ref={selected ? selectedOptionRef : null}
            className={`grid min-w-0 gap-1 rounded-lg px-3 py-2 text-left transition-colors ${selected ? "bg-surface-emphasis text-foreground" : "hover:bg-surface-sunken"}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(cmd);
            }}
            onMouseEnter={() => onHover(index)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono font-semibold">{commandLabel}</span>
              <span className={resolveCommandKindBadgeClass(cmd.kind)}>
                {formatCommandKind(cmd.kind)}
              </span>
              {cmd.source ? (
                <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-2xs font-semibold text-muted-foreground">
                  {cmd.source}
                </span>
              ) : null}
            </span>
            {description ? (
              <span className="truncate text-xs text-muted-foreground">
                {description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function formatCommandKind(kind: AvailableCommandKind | undefined) {
  return kind ?? "command";
}

function resolveCommandKindBadgeClass(kind: AvailableCommandKind | undefined) {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide";
  if (kind === "skill") return `${base} bg-primary-soft text-primary`;
  if (kind === "builtin") return `${base} bg-warning/15 text-warning`;
  if (kind === "prompt" || kind === "workflow") return `${base} bg-success-container text-on-success-container`;
  if (kind === "unknown") return `${base} bg-surface-sunken text-muted-foreground`;
  return `${base} bg-surface-sunken text-muted-foreground`;
}
