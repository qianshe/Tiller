import { Tabs, TabsList, TabsTrigger } from "../../../shared/ui/tabs";
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
    <Tabs value={selectedPageId} onValueChange={onSelect}>
      <TabsList
        size="sm"
        aria-label="展示页"
        className="mission-panel-tree flex h-auto min-h-8 w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-b border-border-ghost bg-transparent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page) => {
          const custom = page.id.startsWith("custom-");
          return (
            <TabsTrigger
              key={page.id}
              size="xs"
              value={page.id}
              draggable={custom}
              onDragStart={() => (custom ? onDragStart(page.id) : undefined)}
              onDragOver={(event) => { if (custom) event.preventDefault(); }}
              onDrop={() => (custom ? onDrop(page.id) : undefined)}
              className="gap-1"
            >
              <span className="text-sm">{resolveMissionPanelIcon(page.id)}</span>
              <span>{page.title}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
