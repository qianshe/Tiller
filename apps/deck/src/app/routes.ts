import type { DeckLanguage } from "../features/preferences/storage";

export type AppView = "overview" | "sessions" | "agents" | "settings";

export const VIEW_PATHS: Record<AppView, string> = {
  overview: "/",
  sessions: "/mission",
  agents: "/agents",
  settings: "/settings",
};

export const NAV_LABELS: Record<DeckLanguage, Record<AppView, string>> = {
  "zh-CN": {
    overview: "总览",
    sessions: "任务",
    agents: "舰队",
    settings: "设置",
  },
  "en-US": {
    overview: "总览",
    sessions: "任务",
    agents: "舰队",
    settings: "设置",
  },
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
