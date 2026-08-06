import { useState } from "react";
import { Icon } from "./icon";

export type DeckDensity = "compact" | "default" | "cozy";
export type DeckViewportMode = "auto" | "mobile" | "tablet" | "desktop";
export type DeckTweakTheme = "system" | "light" | "dark" | "harbor" | "voyage" | "chart";

type TweaksPanelProps = {
  enabled?: boolean;
  initialOpen?: boolean;
  theme: DeckTweakTheme;
  onThemeChange: (theme: DeckTweakTheme) => void;
  density: DeckDensity;
  onDensityChange: (density: DeckDensity) => void;
  viewport: DeckViewportMode;
  onViewportChange: (viewport: DeckViewportMode) => void;
};

const THEMES: Array<{ value: DeckTweakTheme; label: string }> = [
  { value: "system", label: "sys" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
  { value: "harbor", label: "harbor" },
  { value: "voyage", label: "voyage" },
  { value: "chart", label: "chart" },
];

const DENSITIES: Array<{ value: DeckDensity; label: string }> = [
  { value: "compact", label: "20px" },
  { value: "default", label: "24px" },
  { value: "cozy", label: "28px" },
];

const VIEWPORTS: Array<{ value: DeckViewportMode; label: string }> = [
  { value: "auto", label: "auto" },
  { value: "desktop", label: "desk" },
  { value: "tablet", label: "tab" },
  { value: "mobile", label: "mob" },
];

export function TweaksPanel({
  enabled = false,
  initialOpen = false,
  theme,
  onThemeChange,
  density,
  onDensityChange,
  viewport,
  onViewportChange,
}: TweaksPanelProps) {
  const [open, setOpen] = useState(initialOpen);

  if (!enabled) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-[55]">
      {open ? (
        <div
          className="wb-pane mb-2 grid w-[240px] gap-2 p-2"
          style={{ background: "var(--popover-glass)", backdropFilter: "blur(20px)" }}
        >
          <div>
            <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">主题</div>
            <div className="flex gap-1">
              {THEMES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onThemeChange(item.value)}
                  className={`h-6 flex-1 rounded font-mono text-2xs tabular ${
                    theme === item.value ? "bg-primary text-on-primary" : "bg-surface-sunken hover:bg-surface-emphasis"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">密度</div>
            <div className="flex gap-1">
              {DENSITIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onDensityChange(item.value)}
                  className={`h-6 flex-1 rounded font-mono text-2xs tabular ${
                    density === item.value ? "bg-primary text-on-primary" : "bg-surface-sunken hover:bg-surface-emphasis"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">视口</div>
            <div className="flex gap-1">
              {VIEWPORTS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onViewportChange(item.value)}
                  className={`h-6 flex-1 rounded font-mono text-2xs tabular ${
                    viewport === item.value ? "bg-primary text-on-primary" : "bg-surface-sunken hover:bg-surface-emphasis"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="wb-focus-ring grid h-9 w-9 place-items-center rounded-full bg-surface-emphasis transition-colors hover:bg-surface-elevated"
        style={{ boxShadow: "inset 0 0 0 1px var(--border-ghost), 0 8px 20px rgb(0 0 0 / 0.18)" }}
        title="设计 Tweaks"
        aria-label="设计 Tweaks"
      >
        <Icon name="settings" size={14} className="text-muted-foreground" />
      </button>
    </div>
  );
}
