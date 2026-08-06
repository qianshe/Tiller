import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../shared/ui";

const POPOVER_MARGIN = 8;
const POPOVER_GAP = 8;

type AnchorRect = Pick<DOMRect, "bottom" | "left" | "right" | "top">;

type FloatingSelectionPositionInput = {
  anchorRect: AnchorRect;
  containmentRect?: AnchorRect;
  popoverHeight: number;
  popoverWidth: number;
  viewportHeight: number;
  viewportWidth: number;
};

export type FloatingSelectionPosition = {
  left: number;
  placement: "above" | "below";
  top: number;
};

export function resolveFloatingSelectionPosition({
  anchorRect,
  containmentRect,
  popoverHeight,
  popoverWidth,
  viewportHeight,
  viewportWidth,
}: FloatingSelectionPositionInput): FloatingSelectionPosition {
  const anchorCenter = (anchorRect.left + anchorRect.right) / 2;
  const boundaryLeft = Math.max(
    POPOVER_MARGIN,
    containmentRect ? containmentRect.left + POPOVER_MARGIN : POPOVER_MARGIN,
  );
  const boundaryRight = Math.min(
    viewportWidth - POPOVER_MARGIN,
    containmentRect
      ? containmentRect.right - POPOVER_MARGIN
      : viewportWidth - POPOVER_MARGIN,
  );
  const maxLeft = Math.max(boundaryLeft, boundaryRight - popoverWidth);
  const left = Math.min(
    Math.max(anchorCenter - popoverWidth / 2, boundaryLeft),
    maxLeft,
  );
  const belowTop = anchorRect.bottom + POPOVER_GAP;
  const aboveTop = anchorRect.top - popoverHeight - POPOVER_GAP;
  const canFitBelow = belowTop + popoverHeight + POPOVER_MARGIN <= viewportHeight;
  const maxTop = Math.max(POPOVER_MARGIN, viewportHeight - popoverHeight - POPOVER_MARGIN);

  // 优先放选区下方:移动端系统原生选区工具条(拷贝/查询/分享)常出现在选区上方,
  // 我们让出上方空间,避免气泡与之重叠。仅当下方放不下时才回退上方。
  const placement: "above" | "below" = canFitBelow ? "below" : "above";
  const primaryTop = canFitBelow ? belowTop : aboveTop;
  const canFitAbove = aboveTop >= POPOVER_MARGIN;
  const fallbackTop = canFitAbove ? aboveTop : belowTop;

  return {
    left,
    placement,
    top: Math.min(
      Math.max(canFitBelow ? primaryTop : fallbackTop, POPOVER_MARGIN),
      maxTop,
    ),
  };
}

export type SelectionCommentAnchor = {
  getBoundingClientRect: () => AnchorRect;
};

type SelectionCommentPopoverProps = {
  anchor: SelectionCommentAnchor;
  comment?: string;
  containment?: SelectionCommentAnchor;
  context?: ReactNode;
  mode: "actions" | "composer";
  onCancel: () => void;
  onChangeComment?: (comment: string) => void;
  onOpenComposer?: () => void;
  onSubmit?: () => void;
};

export function SelectionCommentPopover({
  anchor,
  comment = "",
  containment,
  context,
  mode,
  onCancel,
  onChangeComment,
  onOpenComposer,
  onSubmit,
}: SelectionCommentPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingSelectionPosition | null>(null);

  useLayoutEffect(() => {
    let animationFrame: number | null = null;

    const updatePosition = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        const popover = popoverRef.current;
        if (!popover) {
          return;
        }
        const anchorRect = anchor.getBoundingClientRect();
        const containmentRect = containment?.getBoundingClientRect();
        setPosition(resolveFloatingSelectionPosition({
          anchorRect,
          containmentRect,
          popoverHeight: popover.offsetHeight,
          popoverWidth: popover.offsetWidth,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        }));
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, containment, mode]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (mode === "composer") {
        return;
      }
      if (popoverRef.current?.contains(event.target as Node)) {
        return;
      }
      onCancel();
    };

    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [onCancel, mode]);

  if (typeof document === "undefined") {
    return null;
  }

  const style: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { left: 0, top: 0, visibility: "hidden" };

  return createPortal(
    <div
      ref={popoverRef}
      className="selection-comment-popover pointer-events-auto fixed z-[80] max-w-[calc(100vw-1rem)] rounded-lg border border-border-ghost/80 bg-surface-elevated p-1 text-foreground shadow-[0_14px_36px_rgb(0_0_0/0.34)] ring-1 ring-white/5"
      data-placement={position?.placement}
      role={mode === "actions" ? "toolbar" : "dialog"}
      aria-label={mode === "actions" ? "选区评论操作" : "添加选区评论"}
      style={style}
    >
      {mode === "actions" ? (
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2.5"
            onClick={onOpenComposer}
          >
            添加评论
          </Button>
          <span className="h-4 w-px bg-border-ghost/80" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2.5 text-muted-foreground"
            onClick={onCancel}
          >
            取消
          </Button>
        </div>
      ) : (
        <div className="grid w-[min(22rem,calc(100vw-1.5rem))] max-w-full gap-2 p-1.5 max-[767px]:w-[min(18rem,calc(100vw-3rem))] max-[767px]:gap-1.5 max-[767px]:p-1">
          {context ? (
            <div className="flex min-w-0 items-center gap-1.5 px-0.5 text-2xs leading-4 text-muted-foreground">
              {context}
            </div>
          ) : null}
          <textarea
            autoFocus
            value={comment}
            onChange={(event) => onChangeComment?.(event.currentTarget.value)}
            className="min-h-20 w-full resize-none rounded-md bg-surface-sunken px-2.5 py-2 text-section text-foreground outline-none ring-1 ring-border-ghost/70 transition-shadow placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/45"
            placeholder="添加评论或要求..."
          />
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!comment.trim()}
              onClick={onSubmit}
            >
              添加到对话
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
