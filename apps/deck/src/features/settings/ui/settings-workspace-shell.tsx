import type { ReactNode } from "react";
import { Button, Icon } from "@/shared/ui";
import { SettingsNavigation } from "./settings-navigation";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections";

export type SettingsPageMode = "standalone" | "dashboard";

type SettingsWorkspaceShellProps = {
  activeSection: SettingsSectionId;
  mode?: SettingsPageMode;
  mobileScreen: "list" | "detail";
  onMobileScreenChange: (screen: "list" | "detail") => void;
  onSelectSection: (id: SettingsSectionId) => void;
  onReset: () => void;
  children: ReactNode;
};

function resolveSectionMeta(id: SettingsSectionId) {
  return SETTINGS_SECTIONS.find((section) => section.id === id)!;
}

function SettingsMobileSectionList({
  onSelectSection,
  onMobileScreenChange,
  mode = "standalone",
}: Pick<SettingsWorkspaceShellProps, "mode" | "onSelectSection" | "onMobileScreenChange">) {
  return (
    <section className="settings-workspace-shell flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface">
      {mode !== "dashboard" ? (
        <div className="flex min-h-14 shrink-0 items-center border-b border-border-ghost px-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">设置</h1>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid gap-1">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => {
                onSelectSection(section.id);
                onMobileScreenChange("detail");
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors hover:bg-surface-sunken active:bg-surface-emphasis"
            >
              <Icon name={section.icon} size={16} className="text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-foreground">{section.label}</span>
                <span className="block truncate text-2xs text-muted-foreground">{section.desc}</span>
              </span>
              <Icon name="chevronRight" size={14} className="text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SettingsWorkspaceShell({
  activeSection,
  mode = "standalone",
  mobileScreen,
  onMobileScreenChange,
  onSelectSection,
  onReset,
  children,
}: SettingsWorkspaceShellProps) {
  const activeSectionMeta = resolveSectionMeta(activeSection);

  if (mobileScreen === "list") {
    return (
      <SettingsMobileSectionList
        mode={mode}
        onSelectSection={onSelectSection}
        onMobileScreenChange={onMobileScreenChange}
      />
    );
  }

  return (
    <section className="settings-workspace-shell flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNavigation
        activeId={activeSection}
        onSelect={onSelectSection}
        showHeading={mode !== "dashboard"}
      />

      <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-surface">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-ghost px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{activeSectionMeta.label}</h1>
            <p className="mt-1 text-section text-muted-foreground">{activeSectionMeta.desc}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            title="重置所有 Deck 前端偏好"
            onClick={onReset}
            className="shrink-0 text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
          >
            重置全部
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8 sm:py-7">
          <div className="w-full">{children}</div>
        </div>
      </section>
    </section>
  );
}

export function SettingsWorkspaceMobileDetail({
  activeSection,
  mode = "standalone",
  onMobileScreenChange,
  onReset,
  children,
}: Pick<SettingsWorkspaceShellProps, "activeSection" | "mode" | "onMobileScreenChange" | "onReset" | "children">) {
  const activeSectionMeta = resolveSectionMeta(activeSection);

  return (
    <section className="settings-workspace-shell flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface">
      <div className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border-ghost px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          onClick={() => onMobileScreenChange("list")}
          title="返回设置分类"
          className="shrink-0"
        >
          <Icon name="chevronLeft" size={14} />
        </Button>
        <div className="min-w-0">
          {mode !== "dashboard" ? (
            <p className="font-mono text-meta uppercase tracking-[0.16em] text-muted-foreground">设置</p>
          ) : null}
          <h1 className="truncate text-base font-semibold text-foreground">{activeSectionMeta.label}</h1>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" type="button" title="重置所有 Deck 前端偏好" onClick={onReset}>
          重置全部
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-5">{children}</div>
    </section>
  );
}
