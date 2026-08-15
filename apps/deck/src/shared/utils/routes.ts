import type { DeckLanguage } from "../config/deck-language";

export type AppView = "overview" | "dashboard" | "sessions" | "agents" | "settings";

export const NAV_LABELS: Record<DeckLanguage, Record<AppView, string>> = {
  "zh-CN": {
    overview: "总览",
    dashboard: "概览",
    sessions: "任务",
    agents: "舰队",
    settings: "设置",
  },
  "en-US": {
    overview: "Home",
    dashboard: "Dashboard",
    sessions: "Workbench",
    agents: "Fleet",
    settings: "Settings",
  },
};

export const VIEW_PATHS: Record<AppView, string> = {
  overview: "/",
  dashboard: "/dashboard",
  sessions: "/mission",
  agents: "/agents",
  settings: "/settings",
};

export function resolveViewFromPath(pathname: string): AppView {
  const normalized = pathname.replace(/\/+$/g, "") || "/";
  if (normalized === "/sessions") {
    return "sessions";
  }
  const matched = (Object.entries(VIEW_PATHS) as Array<[AppView, string]>).find(
    ([, path]) => path === normalized,
  );
  return matched?.[0] ?? "overview";
}
