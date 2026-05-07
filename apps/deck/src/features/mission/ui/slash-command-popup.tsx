import type { AvailableCommand } from "@tiller/shared";

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
  const selectedCommand = commands[selectedIndex] ?? commands[0];
  const selectedDescription = selectedCommand
    ? selectedCommand.description ?? selectedCommand.input?.hint ?? `插入 /${selectedCommand.name} 命令。`
    : "";

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-2 flex max-w-[min(36rem,calc(100vw-3rem))] items-start gap-2"
      role="listbox"
    >
      <div className="grid max-h-80 w-72 max-w-[calc(100vw-3rem)] gap-0.5 overflow-y-auto rounded-xl border border-border-ghost bg-surface-elevated p-1.5 font-mono text-sm shadow-ambient">
        {commands.map((cmd, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={`/${cmd.name}`}
              className={`grid min-w-0 grid-cols-[minmax(0,1fr)] rounded-md px-2.5 py-1 text-left text-foreground transition-colors ${selected ? "bg-surface-emphasis text-foreground" : "hover:bg-surface-sunken"}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(cmd);
              }}
              onMouseEnter={() => onHover(index)}
            >
              <span className="truncate">{cmd.name}</span>
            </button>
          );
        })}
      </div>
      {selectedCommand ? (
        <aside className="hidden w-56 max-w-[calc(100vw-22rem)] rounded-xl border border-border-ghost bg-surface-elevated p-3 text-sm leading-6 text-foreground shadow-ambient md:block">
          <div className="mb-2 font-mono text-xs font-semibold text-muted-foreground">
            /{selectedCommand.name}
          </div>
          <p className="whitespace-pre-wrap break-words">{selectedDescription}</p>
          {selectedCommand.input?.hint && selectedCommand.input.hint !== selectedDescription ? (
            <p className="mt-2 rounded-md bg-surface-sunken px-2 py-1 font-mono text-xs text-muted-foreground">
              {selectedCommand.input.hint}
            </p>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}



