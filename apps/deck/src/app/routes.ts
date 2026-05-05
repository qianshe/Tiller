import type { DeckLanguage } from "../features/preferences/storage";
import { type AppView } from "../shared/utils/routes";
export {
  VIEW_PATHS,
  resolveViewFromPath,
  type AppView,
} from "../shared/utils/routes";

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
