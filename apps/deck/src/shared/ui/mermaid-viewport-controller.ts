export type MermaidViewportState = {
  scale: number;
  x: number;
  y: number;
  dragging: boolean;
};

type MermaidViewportOptions = {
  minScale?: number;
  maxScale?: number;
  zoomStep?: number;
};

type DragOrigin = {
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
};

type PinchOrigin = {
  distance: number;
  scale: number;
};

export class MermaidViewportController {
  private readonly minScale: number;
  private readonly maxScale: number;
  private readonly zoomStep: number;
  private state: MermaidViewportState = { scale: 1, x: 0, y: 0, dragging: false };
  private dragOrigin: DragOrigin | null = null;
  private pinchOrigin: PinchOrigin | null = null;

  constructor(options: MermaidViewportOptions = {}) {
    this.minScale = options.minScale ?? 0.5;
    this.maxScale = options.maxScale ?? 8;
    this.zoomStep = options.zoomStep ?? 0.25;
  }

  getState(): MermaidViewportState {
    return { ...this.state };
  }

  getTransformStyle(): string {
    return `translate(-50%, -50%) translate(${this.state.x}px, ${this.state.y}px) scale(${this.state.scale})`;
  }

  canZoomIn(): boolean {
    return this.state.scale < this.maxScale;
  }

  canZoomOut(): boolean {
    return this.state.scale > this.minScale;
  }

  zoomIn(): MermaidViewportState {
    return this.setScale(this.state.scale + this.zoomStep);
  }

  zoomOut(): MermaidViewportState {
    return this.setScale(this.state.scale - this.zoomStep);
  }

  zoomByWheel(deltaY: number): MermaidViewportState {
    return deltaY < 0 ? this.zoomIn() : this.zoomOut();
  }

  reset(): MermaidViewportState {
    this.state = { scale: 1, x: 0, y: 0, dragging: false };
    this.dragOrigin = null;
    this.pinchOrigin = null;
    return this.getState();
  }

  beginDrag(pointerX: number, pointerY: number): MermaidViewportState {
    this.dragOrigin = { pointerX, pointerY, x: this.state.x, y: this.state.y };
    this.state = { ...this.state, dragging: true };
    return this.getState();
  }

  dragTo(pointerX: number, pointerY: number): MermaidViewportState {
    if (!this.dragOrigin) {
      return this.getState();
    }

    this.state = {
      ...this.state,
      x: this.dragOrigin.x + pointerX - this.dragOrigin.pointerX,
      y: this.dragOrigin.y + pointerY - this.dragOrigin.pointerY,
      dragging: true,
    };
    return this.getState();
  }

  endDrag(): MermaidViewportState {
    this.dragOrigin = null;
    this.state = { ...this.state, dragging: false };
    return this.getState();
  }

  beginPinch(distance: number): MermaidViewportState {
    if (distance <= 0) {
      return this.getState();
    }
    this.dragOrigin = null;
    this.pinchOrigin = { distance, scale: this.state.scale };
    this.state = { ...this.state, dragging: false };
    return this.getState();
  }

  pinchTo(distance: number): MermaidViewportState {
    if (!this.pinchOrigin || distance <= 0) {
      return this.getState();
    }
    return this.setScale(this.pinchOrigin.scale * (distance / this.pinchOrigin.distance));
  }

  endPinch(): MermaidViewportState {
    this.pinchOrigin = null;
    this.state = { ...this.state, dragging: false };
    return this.getState();
  }

  private setScale(scale: number): MermaidViewportState {
    this.state = {
      ...this.state,
      scale: Math.min(this.maxScale, Math.max(this.minScale, scale)),
    };
    return this.getState();
  }
}
