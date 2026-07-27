import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";

/**
 * 检测当前主指针是否为粗指针（触控设备）。
 * 粗指针设备没有 hover 能力，桌面端依赖 hover 的交互需要替代方案。
 * SSR 安全：初始返回 false，仅在客户端 effect 内读取 matchMedia。
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
 * 触控手势 hook。默认在 touchStart 后超过 ms 触发 onReach；reachOnRelease
 * 则改为抬手时触发，适用于保留移动容差的轻点交互。
 * 手指移动超过 moveTolerance 视为滚动/取消，touchEnd/touchCancel 清除。
 * 触达后保持 pressing=true 直到手指抬起，给用户视觉确认。
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
      if (event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      startRef.current = { x: touch.clientX, y: touch.clientY };
      setPressing(true);
      clearTimer();
      if (reachOnRelease) {
        return;
      }
      timerRef.current = window.setTimeout(() => {
        onReachRef.current();
      }, ms);
    },
    onTouchMove: (event) => {
      const start = startRef.current;
      const touch = event.touches[0];
      if (!start || !touch) {
        return;
      }
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.hypot(dx, dy) > moveTolerance) {
        reset();
      }
    },
    onTouchEnd: () => {
      const shouldReach = reachOnRelease && startRef.current !== null;
      reset();
      if (shouldReach) {
        onReachRef.current();
      }
    },
    onTouchCancel: () => {
      reset();
    },
  };

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { pressing, bind };
}
