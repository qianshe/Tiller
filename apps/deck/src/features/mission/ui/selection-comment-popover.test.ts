import assert from "node:assert/strict";
import test from "node:test";
import { resolveFloatingSelectionPosition } from "./selection-comment-popover";

test("floating selection actions prefer the space above the selected text", () => {
  assert.deepEqual(resolveFloatingSelectionPosition({
    anchorRect: { bottom: 220, left: 200, right: 300, top: 200 },
    popoverHeight: 40,
    popoverWidth: 180,
    viewportHeight: 600,
    viewportWidth: 800,
  }), {
    left: 160,
    placement: "above",
    top: 152,
  });
});

test("floating selection actions move below a selection near the viewport top", () => {
  assert.deepEqual(resolveFloatingSelectionPosition({
    anchorRect: { bottom: 28, left: 12, right: 64, top: 8 },
    popoverHeight: 40,
    popoverWidth: 180,
    viewportHeight: 600,
    viewportWidth: 800,
  }), {
    left: 8,
    placement: "below",
    top: 36,
  });
});

test("floating selection actions stay inside the right viewport edge", () => {
  const position = resolveFloatingSelectionPosition({
    anchorRect: { bottom: 220, left: 760, right: 790, top: 200 },
    popoverHeight: 40,
    popoverWidth: 180,
    viewportHeight: 600,
    viewportWidth: 800,
  });

  assert.equal(position.left, 612);
});
