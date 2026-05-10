import assert from "node:assert/strict";
import test from "node:test";

import { MermaidViewportController } from "./mermaid-viewport-controller.js";

test("Mermaid viewport controller clamps zoom and resets transform", () => {
  const controller = new MermaidViewportController({ minScale: 0.5, maxScale: 2, zoomStep: 0.5 });

  controller.zoomOut();
  controller.zoomOut();
  assert.equal(controller.getState().scale, 0.5);

  controller.zoomIn();
  controller.zoomIn();
  controller.zoomIn();
  controller.zoomIn();
  assert.equal(controller.getState().scale, 2);

  controller.reset();
  assert.deepEqual(controller.getState(), { scale: 1, x: 0, y: 0, dragging: false });
});

test("Mermaid viewport controller tracks drag translation", () => {
  const controller = new MermaidViewportController();

  controller.beginDrag(10, 20);
  controller.dragTo(35, 5);
  assert.deepEqual(controller.getState(), { scale: 1, x: 25, y: -15, dragging: true });

  controller.endDrag();
  assert.equal(controller.getState().dragging, false);
});

test("Mermaid viewport controller exposes a reusable transform style", () => {
  const controller = new MermaidViewportController();

  controller.beginDrag(0, 0);
  controller.dragTo(24, -12);
  controller.zoomIn();

  assert.equal(
    controller.getTransformStyle(),
    "translate(-50%, -50%) translate3d(24px, -12px, 0) scale(1.25)",
  );
});

test("Mermaid viewport controller supports clamped pinch zoom", () => {
  const controller = new MermaidViewportController({ minScale: 0.5, maxScale: 2 });

  controller.beginPinch(100);
  controller.pinchTo(250);
  assert.equal(controller.getState().scale, 2);

  controller.beginPinch(100);
  controller.pinchTo(10);
  assert.equal(controller.getState().scale, 0.5);

  controller.endPinch();
  assert.equal(controller.getState().dragging, false);
});
