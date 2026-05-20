import type { ReactNode } from "react";

const PROVIDER_ICON_URLS = {
  claude: new URL("../assets/provider-icons/claude-code.svg", import.meta.url).href,
  codex: new URL("../assets/provider-icons/codex.svg", import.meta.url).href,
  cursor: new URL("../assets/provider-icons/cursor.svg", import.meta.url).href,
  gemini: new URL("../assets/provider-icons/gemini.svg", import.meta.url).href,
} as const;

export type TillerIconName =
  | "home"
  | "board"
  | "mission"
  | "fleet"
  | "settings"
  | "helm"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "send"
  | "sparkle"
  | "more"
  | "plus"
  | "x"
  | "search"
  | "globe"
  | "server"
  | "folder"
  | "clock"
  | "shield"
  | "activity"
  | "terminal"
  | "branch"
  | "fileText"
  | "inspect"
  | "panel"
  | "message";

const ICONS: Record<TillerIconName, ReactNode> = {
  helm: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <line x1="12" y1="3" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="3" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="21" y2="12" />
    </>
  ),
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z" />,
  board: (
    <>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="6" height="10" rx="1" />
      <rect x="19" y="4" width="2" height="13" rx="1" />
    </>
  ),
  mission: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  fleet: (
    <>
      <path d="M2 20a6 6 0 0 0 12 0 6 6 0 0 0 8 0" />
      <path d="M5 12V7l7-3 7 3v5" />
      <path d="M5 12h14l-2 6H7l-2-6Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <path d="M5.5 5.5l13 13" />
      <path d="M18.5 5.5l-13 13" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  server: (
    <>
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </>
  ),
  folder: <path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  branch: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </>
  ),
  inspect: (
    <>
      <rect width="14" height="14" x="3" y="3" rx="2" />
      <path d="m21 21-3-3" />
    </>
  ),
  panel: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />,
};

type IconProps = {
  name: TillerIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  title?: string;
};

export function Icon({ name, size = 14, className = "", strokeWidth, title }: IconProps) {
  const path = ICONS[name];
  if (!path) {
    return <span className="font-mono text-2xs text-destructive">?{String(name)}</span>;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`.trim()}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  );
}

type AgentIconProps = {
  name?: string;
  size?: number;
  className?: string;
};

function resolveProvider(name: string | undefined): keyof typeof PROVIDER_ICON_URLS | null {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("codex") || normalized.includes("gpt") || normalized.includes("openai")) return "codex";
  if (normalized.includes("claude") || normalized.includes("sonnet") || normalized.includes("opus") || normalized.includes("anthropic")) return "claude";
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.includes("cursor")) return "cursor";
  return null;
}

export function AgentIcon({ name = "agent", size = 14, className = "" }: AgentIconProps) {
  const provider = resolveProvider(name);
  if (provider) {
    return (
      <img
        src={PROVIDER_ICON_URLS[provider]}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={`shrink-0 ${className}`.trim()}
        style={{ width: size, height: size }}
      />
    );
  }

  const initials = (name || "agent")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";

  return (
    <span
      className={`grid place-items-center rounded-sm bg-surface-emphasis font-mono font-semibold text-foreground shrink-0 ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.5), lineHeight: 1 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

type StatusDotProps = {
  tone?: "active" | "idle" | "warning" | "danger" | "primary";
  pulse?: boolean;
  size?: number;
  className?: string;
};

const STATUS_TONES: Record<NonNullable<StatusDotProps["tone"]>, string> = {
  active: "bg-success",
  idle: "bg-muted-foreground",
  warning: "bg-warning",
  danger: "bg-destructive",
  primary: "bg-primary",
};

export function StatusDot({ tone = "idle", pulse = false, size = 6, className = "" }: StatusDotProps) {
  return (
    <span
      className={`inline-block rounded-full ${STATUS_TONES[tone]} ${pulse ? "wb-pulse" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
