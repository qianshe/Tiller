import type { ConnectionState } from "../../../store/slices/connection-slice";

export function resolveHelmConnectionState(
  helm: { key: string; isCurrent: boolean },
  currentHelmKey: string,
  globalConnection: ConnectionState,
  helmConnectionStates: Record<string, ConnectionState>,
) {
  return (
    helmConnectionStates[helm.key] ??
    (helm.key === currentHelmKey ? globalConnection : "disconnected")
  );
}

export function dedupeHelmCards<T extends { key: string; isCurrent: boolean }>(
  cards: T[],
) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const card of cards) {
    if (seen.has(card.key)) {
      continue;
    }
    seen.add(card.key);
    result.push(card);
  }
  return result;
}
