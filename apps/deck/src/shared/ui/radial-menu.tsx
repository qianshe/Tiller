import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent } from "react";
import type { AppView } from "../utils/routes";
import { Icon, type TillerIconName } from "./icon";

export type RadialMenuItem = {
  id: AppView;
  icon: TillerIconName;
  label: string;
};

type RadialMenuProps = {
  activeView: AppView;
  items: RadialMenuItem[];
  onNavigate: (view: AppView) => void;
  enabled?: boolean;
};

type Position = { left: number; top: number } | null;

export function isWithinRadialMenu(target: EventTarget | null): boolean {
  if (
    target === null
    || (typeof target !== "object" && typeof target !== "function")
  ) {
    return false;
  }
  const closest = (target as { closest?: unknown }).closest;
  return typeof closest === "function"
    && Boolean(
      (closest as (selector: string) => unknown).call(target, "[data-radial]"),
    );
}

export function RadialMenu({ activeView, items, onNavigate, enabled = false }: RadialMenuProps) {
  const [position, setPosition] = useState<Position>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startLeft: 0, startTop: 0, moved: false });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!isWithinRadialMenu(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!enabled || items.length === 0) {
    return null;
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - 56, dragRef.current.startLeft + dx)),
      top: Math.max(8, Math.min(window.innerHeight - 56, dragRef.current.startTop + dy)),
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    if (!dragRef.current.moved) {
      setOpen((current) => !current);
    }
  };

  const focusMenuItem = (index: number) => {
    itemRefs.current[index]?.focus();
  };

  const openAndFocusMenu = () => {
    setOpen(true);
    window.requestAnimationFrame(() => {
      const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeView));
      focusMenuItem(activeIndex);
    });
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      openAndFocusMenu();
    }
  };

  const onHoverPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") {
      setOpen(true);
    }
  };

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(items.length - 1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem((index + 1) % items.length);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem((index - 1 + items.length) % items.length);
    }
  };

  const radius = 64;
  const hoverZoneSize = (radius + 24) * 2;
  const hoverZoneOffset = hoverZoneSize / 2 - 24;
  const angleStep = (Math.PI * 2) / items.length;
  const startAngle = -Math.PI / 2;
  const githubActionRight = "clamp(24px, 4.2vw, 56px)";
  const githubActionTop = "clamp(24px, 3.6vh, 40px)";
  const containerStyle: CSSProperties = position
    ? { left: position.left, top: position.top, position: "fixed" }
    : {
        right: `calc(${githubActionRight} - 2px)`,
        top: `calc(${githubActionTop} + 56px)`,
        position: "fixed",
      };
  const activeLabel = items.find((item) => item.id === activeView)?.label ?? "Tiller";

  return (
    <div data-radial className="pointer-events-none z-[60]" style={containerStyle}>
      <div className="relative pointer-events-auto" style={{ width: 48, height: 48 }}>
        <div
          data-radial-hover-zone
          aria-hidden="true"
          onPointerEnter={onHoverPointerEnter}
          onPointerLeave={(event) => {
            if (!isWithinRadialMenu(event.relatedTarget)) {
              setOpen(false);
            }
          }}
          style={{
            position: "absolute",
            left: -hoverZoneOffset,
            top: -hoverZoneOffset,
            width: hoverZoneSize,
            height: hoverZoneSize,
            borderRadius: "50%",
            pointerEvents: "auto",
            zIndex: 0,
          }}
        />
        {open ? (
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap" style={{ top: 58 }}>
            <span
              className="rounded px-2 py-0.5 font-mono text-2xs uppercase tracking-wider"
              style={{
                background: "var(--surface-elevated)",
                color: "var(--foreground)",
                boxShadow: "inset 0 0 0 1px var(--border-ghost), 0 10px 24px rgb(0 0 0 / 0.18)",
              }}
            >
              {activeLabel}
            </span>
          </div>
        ) : null}
        {items.map((item, index) => {
          const angle = startAngle + angleStep * index;
          const dx = Math.cos(angle) * radius;
          const dy = Math.sin(angle) * radius;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              data-radial
              type="button"
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              onClick={(event) => {
                event.stopPropagation();
                onNavigate(item.id);
                setOpen(false);
              }}
              onKeyDown={(event) => onItemKeyDown(event, index)}
              className="wb-focus-ring absolute grid h-9 w-9 place-items-center rounded-full"
              style={{
                left: 24,
                top: 24,
                marginLeft: -18,
                marginTop: -18,
                transform: open ? `translate(${dx}px, ${dy}px) scale(1)` : "translate(0, 0) scale(0.4)",
                opacity: open ? 1 : 0,
                pointerEvents: open ? "auto" : "none",
                transition: `transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1) ${open ? index * 30 : (items.length - 1 - index) * 20}ms, opacity 200ms ease ${open ? index * 30 : 0}ms`,
                background: active ? "var(--primary)" : "var(--surface-elevated)",
                color: active ? "var(--on-primary)" : "var(--foreground)",
                backdropFilter: "blur(20px)",
                boxShadow: "inset 0 0 0 1px var(--border-ghost), 0 8px 20px rgb(0 0 0 / 0.22)",
                zIndex: 1,
              }}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <Icon name={item.icon} size={14} />
            </button>
          );
        })}
        <button
          data-radial
          type="button"
          ref={triggerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerEnter={onHoverPointerEnter}
          onKeyDown={onTriggerKeyDown}
          className="wb-focus-ring absolute grid h-12 w-12 place-items-center overflow-visible rounded-full"
          style={{
            left: 0,
            top: 0,
            background: "transparent",
            color: "var(--foreground)",
            backdropFilter: "blur(2px) saturate(125%)",
            WebkitBackdropFilter: "blur(2px) saturate(125%)",
            boxShadow: "inset 0 0 0 2.5px var(--primary), 0 14px 32px rgb(0 0 0 / 0.18)",
            zIndex: 1,
            cursor: dragging ? "grabbing" : "grab",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            touchAction: "none",
          }}
          aria-label={open ? "收起轮盘" : "展开轮盘 · 拖动可移动"}
          title={open ? "收起" : "点击展开 · 拖动移动"}
        >
          <Icon name="helm" size={24} strokeWidth={1.3} />
        </button>
      </div>
    </div>
  );
}
