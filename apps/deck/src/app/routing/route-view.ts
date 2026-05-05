import { useEffect, useState } from "react";
import { VIEW_PATHS, resolveViewFromPath, type AppView } from "./routes";

/**
 * Owns Deck view state and keeps browser history in sync with app routes.
 */
export function useRouteView() {
  const [activeView, setActiveView] = useState<AppView>(() =>
    resolveViewFromPath(window.location.pathname),
  );

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(resolveViewFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/g, "") === "/sessions") {
      window.history.replaceState({}, "", VIEW_PATHS.sessions);
    }
  }, []);

  function navigateToView(view: AppView) {
    const nextPath = VIEW_PATHS[view];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setActiveView(view);
  }

  return { activeView, navigateToView };
}
