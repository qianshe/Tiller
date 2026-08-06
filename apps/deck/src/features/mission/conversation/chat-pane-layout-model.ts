export const PARALLEL_GRID_MIN_COLUMN_WIDTH_PX = 360;
export const PARALLEL_GRID_GAP_PX = 8;

/**
 * 由 grid 内容宽度推导并排卡片能否排成一行。
 * 判据只依赖宽度这一与行高状态无关的输入(不读卡片 offsetTop),
 * 从结构上杜绝"测量结果→切换 gridAutoRows→布局变化→再测量"的反馈回路。
 * 列宽/间距需与 parallelGridStyle 的 repeat(auto-fit, minmax(min(100%, 360px), 1fr)) + gap-2 保持一致。
 */
export function resolveParallelGridSingleRow({
  gridContentWidth,
  cardCount,
}: {
  gridContentWidth: number;
  cardCount: number;
}) {
  if (cardCount <= 0 || gridContentWidth <= 0) {
    return false;
  }
  const columnsThatFit = Math.floor(
    (gridContentWidth + PARALLEL_GRID_GAP_PX) /
      (PARALLEL_GRID_MIN_COLUMN_WIDTH_PX + PARALLEL_GRID_GAP_PX),
  );
  return columnsThatFit >= cardCount;
}

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
