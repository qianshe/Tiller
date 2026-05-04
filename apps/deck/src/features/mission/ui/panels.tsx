import { resolveMissionPanelIcon } from "./diff-tree";

export type MissionPanelPage = {
  id: string;
  title: string;
};

export function MissionPanelNav({
  pages,
  selectedPageId,
  onSelect,
  onDragStart,
  onDrop,
}: {
  pages: MissionPanelPage[];
  selectedPageId: string;
  onSelect: (pageId: string) => void;
  onDragStart: (pageId: string) => void;
  onDrop: (pageId: string) => void;
}) {
  return (
    <nav className="mission-panel-tree" aria-label="展示页">
      {pages.map((page) => {
        const custom = page.id.startsWith("custom-");
        return (
          <button
            className={`mission-panel-node ${selectedPageId === page.id ? "active" : ""}`}
            draggable={custom}
            key={page.id}
            type="button"
            onClick={() => onSelect(page.id)}
            onDragStart={() => custom ? onDragStart(page.id) : undefined}
            onDragOver={(event) => { if (custom) event.preventDefault(); }}
            onDrop={() => custom ? onDrop(page.id) : undefined}
          >
            <span className="mission-panel-node-icon">{resolveMissionPanelIcon(page.id)}</span>
            <span>{page.title}</span>
          </button>
        );
      })}
    </nav>
  );
}