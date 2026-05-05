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
  return (
    <div className="slash-command-popup" role="listbox">
      {commands.map((cmd, index) => (
        <button
          key={cmd.name}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={`slash-command-item ${index === selectedIndex ? "selected" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(cmd);
          }}
          onMouseEnter={() => onHover(index)}
        >
          <span className="slash-command-name">/{cmd.name}</span>
          {cmd.description ? (
            <span className="slash-command-desc">{cmd.description}</span>
          ) : null}
          {cmd.input?.hint ? (
            <span className="slash-command-hint">{cmd.input.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
