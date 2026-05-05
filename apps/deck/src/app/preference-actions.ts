import {
  DEFAULT_DECK_PREFERENCES,
  type DeckPreferences,
  type TechnicalPanelPreferences,
} from "../features/preferences/storage";
import { resolveTechnicalPanelPreferences } from "../features/preferences/utils/helpers";

type UseDeckPreferenceActionsOptions = {
  deckPreferences: DeckPreferences;
  updatePreferences: (patch: Partial<DeckPreferences>) => void;
};

export function useDeckPreferenceActions({
  deckPreferences,
  updatePreferences,
}: UseDeckPreferenceActionsOptions) {
  function updateDeckPreference<K extends keyof DeckPreferences>(
    key: K,
    value: DeckPreferences[K],
  ) {
    updatePreferences({ [key]: value } as Partial<DeckPreferences>);
  }

  function updateTechnicalPanelPreference<
    K extends keyof TechnicalPanelPreferences,
  >(key: K, value: TechnicalPanelPreferences[K]) {
    updatePreferences({
      technicalPanels: {
        ...resolveTechnicalPanelPreferences(deckPreferences),
        [key]: value,
      },
    });
  }

  function resetDeckPreferences() {
    updatePreferences(DEFAULT_DECK_PREFERENCES);
  }

  return {
    resetDeckPreferences,
    updateDeckPreference,
    updateTechnicalPanelPreference,
  };
}
