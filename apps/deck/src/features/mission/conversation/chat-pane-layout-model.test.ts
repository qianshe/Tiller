import assert from "node:assert/strict";
import test from "node:test";
import { buildParallelChatLayoutModel } from "./chat-pane-layout-model";

test("buildParallelChatLayoutModel compacts one or two cards", () => {
  assert.deepEqual(buildParallelChatLayoutModel({ sessionCount: 1, hasDraftWindow: false }), {
    isSingleSession: true,
    parallelGridCompact: true,
    parallelGridFillsContainer: true,
    shouldLockChatMainScroll: true,
    shouldAnchorActiveParallelCard: false,
    parallelGridStyle: {
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
      gridAutoRows: "minmax(0, 1fr)",
    },
  });
});

test("buildParallelChatLayoutModel expands three or more cards", () => {
  const model = buildParallelChatLayoutModel({ sessionCount: 2, hasDraftWindow: true });

  assert.equal(model.isSingleSession, false);
  assert.equal(model.parallelGridCompact, false);
  assert.equal(model.parallelGridFillsContainer, false);
  assert.equal(model.shouldLockChatMainScroll, false);
  assert.equal(model.shouldAnchorActiveParallelCard, true);
  assert.equal(model.parallelGridStyle.gridAutoRows, "minmax(360px, min(52vh, 560px))");
});

test("buildParallelChatLayoutModel fills the container while parallel cards stay on one row", () => {
  const model = buildParallelChatLayoutModel({
    sessionCount: 3,
    hasDraftWindow: false,
    singleRow: true,
  });

  assert.equal(model.isSingleSession, false);
  assert.equal(model.parallelGridCompact, false);
  assert.equal(model.parallelGridFillsContainer, true);
  assert.equal(model.shouldLockChatMainScroll, true);
  assert.equal(model.shouldAnchorActiveParallelCard, true);
  assert.equal(model.parallelGridStyle.gridAutoRows, "minmax(0, 1fr)");
});
