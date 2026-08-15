import { Icon } from "@/shared/ui";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections";

type SettingsNavigationProps = {
  activeId: SettingsSectionId;
  onSelect?: (id: SettingsSectionId) => void;
  showHeading?: boolean;
};

export function SettingsNavigation({ activeId, onSelect, showHeading = true }: SettingsNavigationProps) {
  return (
    <nav className="settings-section-nav flex min-h-0 min-w-0 flex-col border-b border-border-ghost bg-surface-sunken/30 md:border-b-0 md:border-r" aria-label="设置分类">
      {showHeading ? (
        <div className="shrink-0 px-4 pb-3 pt-5 md:px-5 md:pt-6">
          <h2 className="text-base font-semibold text-foreground">设置</h2>
          <p className="mt-1 text-2xs text-muted-foreground">偏好、运行时与界面</p>
        </div>
      ) : null}
      <div className={`min-h-0 flex-1 overflow-auto px-3 md:px-4 ${showHeading ? "pb-4" : "py-4"}`}>
        <div className="grid gap-1">
          {SETTINGS_SECTIONS.map((section) => {
            const active = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSelect?.(section.id)}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 text-left transition-colors wb-focus-ring ${
                  active
                    ? "bg-surface-emphasis text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={section.icon} size={14} className={active ? "text-primary" : "text-muted-foreground"} />
                <span className="min-w-0 truncate text-section">{section.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
