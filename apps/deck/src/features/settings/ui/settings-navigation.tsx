import { Icon } from "@/shared/ui";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections";

type SettingsNavigationProps = {
  activeId: SettingsSectionId;
  onSelect?: (id: SettingsSectionId) => void;
};

export function SettingsNavigation({ activeId, onSelect }: SettingsNavigationProps) {
  return (
    <nav className="settings-section-nav wb-pane flex min-h-0 flex-col" aria-label="设置分类">
      <div className="wb-pane-head">
        <span className="wb-pane-head-eyebrow">设置</span>
      </div>
      <div className="flex-1 p-1">
        {SETTINGS_SECTIONS.map((section) => {
          const active = section.id === activeId;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect?.(section.id)}
              className={`flex h-7 w-full items-center gap-2 rounded px-1.5 text-left wb-focus-ring ${
                active ? "bg-surface-emphasis text-foreground" : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={section.icon} size={13} className={active ? "text-primary" : "text-muted-foreground"} />
              <span className="text-[12.5px]">{section.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
