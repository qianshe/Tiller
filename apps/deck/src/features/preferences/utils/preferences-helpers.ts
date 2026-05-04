import {
  DEFAULT_DECK_PREFERENCES,
  type DeckPreferences,
  type TechnicalPanelPreferences,
} from "../preferences-storage";

const DEFAULT_TECHNICAL_PANEL_PREFERENCES: TechnicalPanelPreferences =
  DEFAULT_DECK_PREFERENCES.technicalPanels;

export function resolveTechnicalPanelPreferences(
  preferences: DeckPreferences,
): TechnicalPanelPreferences {
  const legacy =
    (
      preferences as DeckPreferences & {
        technicalPanels?: Partial<TechnicalPanelPreferences>;
      }
    ).technicalPanels ?? {};
  return { ...DEFAULT_TECHNICAL_PANEL_PREFERENCES, ...legacy };
}
