import type { MissionMobilePane } from "../hooks/layout";

type MissionMobilePagerProps = {
  selectedPane: MissionMobilePane;
  onSelectPane: (pane: MissionMobilePane) => void;
};

const ITEMS: Array<{ id: MissionMobilePane; label: string }> = [
  { id: "project", label: "项目" },
  { id: "chat", label: "对话" },
  { id: "display", label: "面板" },
  { id: "inspector", label: "检视" },
];

export function MissionMobilePager({
  selectedPane,
  onSelectPane,
}: MissionMobilePagerProps) {
  return (
    <nav className="mission-mobile-pager" aria-label="任务分栏导航">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mission-mobile-pager-item ${item.id === selectedPane ? "active" : ""}`}
          aria-label={item.label}
          aria-current={item.id === selectedPane ? "page" : undefined}
          onClick={() => onSelectPane(item.id)}
        >
          <span className="mission-mobile-pager-dot" aria-hidden="true" />
          <span className="mission-mobile-pager-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
