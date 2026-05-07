import { cn } from "../../../shared/utils/cn";
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
    <nav className="mission-panel-tree grid content-start gap-1 border-r border-border-ghost bg-surface-sunken/60 p-2 max-[860px]:flex max-[860px]:overflow-x-auto max-[860px]:border-b max-[860px]:border-r-0" aria-label="展示页">
      {pages.map((page) => {
        const custom = page.id.startsWith("custom-");
        return (
          <button
            className={cn("mission-panel-node grid min-h-12 place-items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground transition hover:bg-surface-emphasis hover:text-foreground max-[860px]:min-w-20", selectedPageId === page.id && "active bg-primary-soft text-primary")}
            draggable={custom}
            key={page.id}
            type="button"
            onClick={() => onSelect(page.id)}
            onDragStart={() => custom ? onDragStart(page.id) : undefined}
            onDragOver={(event) => { if (custom) event.preventDefault(); }}
            onDrop={() => custom ? onDrop(page.id) : undefined}
          >
            <span className="mission-panel-node-icon text-base">{resolveMissionPanelIcon(page.id)}</span>
            <span>{page.title}</span>
          </button>
        );
      })}
    </nav>
  );
}