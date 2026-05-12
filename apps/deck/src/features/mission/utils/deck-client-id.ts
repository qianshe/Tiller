const DECK_CLIENT_ID = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function getDeckClientId() {
  return DECK_CLIENT_ID;
}
