import type { ReactNode } from "react";
import type { SettingsSectionId } from "./settings-sections";

type SettingsSectionFrameProps = {
  id: SettingsSectionId;
  label: string;
  desc: string;
  children: ReactNode;
};

export function SettingsSectionFrame({ id, label, desc, children }: SettingsSectionFrameProps) {
  return (
    <section id={`settings-${id}`} className="settings-section-frame wb-pane overflow-hidden" aria-labelledby={`settings-${id}-title`}>
      <header className="wb-pane-head grid-cols-[minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="wb-pane-head-eyebrow">{id}</p>
          <h3 id={`settings-${id}-title`} className="text-default font-semibold text-foreground">
            {label}
          </h3>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </header>
      <div className="grid gap-3 p-4">{children}</div>
    </section>
  );
}

type SettingsRowProps = {
  label: string;
  desc?: string;
  children: ReactNode;
};

export function SettingsRow({ label, desc, children }: SettingsRowProps) {
  return (
    <div className="grid gap-2 border-b border-border-ghost/60 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] md:items-center">
      <div className="grid gap-1">
        <span className="text-default font-medium text-foreground">{label}</span>
        {desc ? <span className="text-xs text-muted-foreground">{desc}</span> : null}
      </div>
      <div className="flex items-center gap-2 md:justify-end">{children}</div>
    </div>
  );
}
