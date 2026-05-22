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
    <section
      id={`settings-${id}`}
      className="settings-section-frame grid gap-3"
      aria-label={`${label} ${desc}`}
    >
      {children}
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
    <div className="flex items-start justify-between gap-6 border-b border-border-ghost py-3 last:border-b-0">
      <div className="flex-1 min-w-0">
        <span className="mb-0.5 block text-default text-foreground">{label}</span>
        {desc ? <span className="text-xs text-muted-foreground">{desc}</span> : null}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}
