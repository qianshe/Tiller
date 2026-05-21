import { useEffect } from "react";
import { useDeckStore } from "../../../store";

function resolveSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function usePreferencesEffects() {
  const language = useDeckStore((state) => state.preferences.language);
  const theme = useDeckStore((state) => state.preferences.theme);
  const reduceMotion = useDeckStore((state) => state.preferences.reduceMotion);
  const density = useDeckStore((state) => state.preferences.density);

  useEffect(() => {
    const applyPreferences = () => {
      const resolvedTheme =
        theme === "system"
          ? resolveSystemTheme()
          : theme === "tiller"
            ? "light"
            : theme;
      document.documentElement.lang = language;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.deckTheme = theme;
      document.documentElement.dataset.deckReduceMotion = String(reduceMotion);
      document.body.dataset.density = density;
    };

    applyPreferences();

    if (theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyPreferences);
    return () => media.removeEventListener("change", applyPreferences);
  }, [language, reduceMotion, theme, density]);
}
