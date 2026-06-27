import type { AppView } from "./routes";

export type AppRouteContext = Record<string, any>;

export type MissionRouteSource = Record<string, any> & {
  activeView: AppView;
  navigateToView: (view: AppView) => void;
};
