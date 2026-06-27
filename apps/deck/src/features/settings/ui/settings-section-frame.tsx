import type { ReactNode } from "react";
import { Switch } from "@/shared/ui";
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
    <div className="flex flex-col gap-2 border-b border-border-ghost py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex-1 min-w-0">
        <span className="mb-0.5 block text-default text-foreground">{label}</span>
        {desc ? <span className="text-xs text-muted-foreground">{desc}</span> : null}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">{children}</div>
    </div>
  );
}

type SettingsSwitchProps = {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function SettingsSwitch({ checked, label, onCheckedChange }: SettingsSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-4 text-right font-mono text-2xs text-muted-foreground tabular">
        {checked ? "开" : "关"}
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
