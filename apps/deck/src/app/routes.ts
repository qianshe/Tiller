import type { DeckLanguage } from "./preferences";

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
