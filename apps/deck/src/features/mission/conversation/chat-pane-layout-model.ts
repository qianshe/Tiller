export function buildParallelChatLayoutModel({
  sessionCount,
  hasDraftWindow,
  singleRow = false,
}: {
  sessionCount: number;
  hasDraftWindow: boolean;
  singleRow?: boolean;
}) {
  const cardCount = sessionCount + (hasDraftWindow ? 1 : 0);
  const parallelGridCompact = cardCount <= 2;
  const parallelGridFillsContainer = parallelGridCompact || singleRow;
  return {
    isSingleSession: sessionCount <= 1,
    parallelGridCompact,
    parallelGridFillsContainer,
    shouldLockChatMainScroll: (sessionCount > 0 || hasDraftWindow) && parallelGridFillsContainer,
    shouldAnchorActiveParallelCard: cardCount > 2,
    parallelGridStyle: {
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
      gridAutoRows: parallelGridFillsContainer ? "minmax(0, 1fr)" : "minmax(360px, min(52vh, 560px))",
    },
  };
}
