import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";

/**
 * Detects whether the primary pointer is a touch-style pointer.
 * The initial value keeps server rendering deterministic.
 */
export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return coarse;
}

type LongPressOptions = {
  onReach: () => void;
  ms?: number;
  moveTolerance?: number;
  reachOnRelease?: boolean;
};

type LongPressBind = {
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
};

/**
 * Keep touch-only interactions available to shared review surfaces without
 * making the code gutter itself intercept normal scrolling or text selection.
 */
export function useLongPress({
  onReach,
  ms = 400,
  moveTolerance = 10,
  reachOnRelease = false,
}: LongPressOptions) {
  const [pressing, setPressing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const onReachRef = useRef(onReach);

  useEffect(() => {
    onReachRef.current = onReach;
  }, [onReach]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    startRef.current = null;
    setPressing(false);
  }, [clearTimer]);

  const bind: LongPressBind = {
    onTouchStart: (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      setPressing(true);
      clearTimer();
      if (reachOnRelease) return;
      timerRef.current = window.setTimeout(() => onReachRef.current(), ms);
    },
    onTouchMove: (event) => {
      const start = startRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.hypot(dx, dy) > moveTolerance) reset();
    },
    onTouchEnd: () => {
      const shouldReach = reachOnRelease && startRef.current !== null;
      reset();
      if (shouldReach) onReachRef.current();
    },
    onTouchCancel: reset,
  };

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { pressing, bind };
}
