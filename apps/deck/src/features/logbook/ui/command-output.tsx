import type { CommandChunk } from "@tiller/shared";

type CommandOutputProps = {
  items: CommandChunk[];
  emptyLabel: string;
};

export function CommandOutput({ items, emptyLabel }: CommandOutputProps) {
  if (!items.length) {
    return (
      <div className="rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <pre
          key={item.id}
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-terminal-bg p-3 font-mono text-sm leading-relaxed text-terminal-fg"
        >
          {item.text}
        </pre>
      ))}
    </div>
  );
}
