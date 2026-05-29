export function buildParallelChatLayoutModel({
  sessionCount,
  hasDraftWindow,
}: {
  sessionCount: number;
  hasDraftWindow: boolean;
}) {
  const cardCount = sessionCount + (hasDraftWindow ? 1 : 0);
  const parallelGridCompact = cardCount <= 2;
  return {
    isSingleSession: sessionCount <= 1,
    parallelGridCompact,
    shouldLockChatMainScroll: (sessionCount > 0 || hasDraftWindow) && parallelGridCompact,
    shouldAnchorActiveParallelCard: cardCount > 2,
    parallelGridStyle: {
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
      gridAutoRows: parallelGridCompact ? "minmax(0, 1fr)" : "minmax(360px, min(52vh, 560px))",
    },
  };
}
