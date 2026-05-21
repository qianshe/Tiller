import { useEffect, useState } from "react";

export type Viewport = "auto" | "desktop" | "tablet" | "mobile";
export type EffectiveViewport = "desktop" | "tablet" | "mobile";

/**
 * 解析 effective viewport · auto 模式按 window.innerWidth 派生
 * 其他模式直接返回 user 设置
 */
export function useEffectiveViewport(viewport: Viewport = "auto"): EffectiveViewport {
  const [effective, setEffective] = useState<EffectiveViewport>(() => {
    if (viewport === "mobile" || viewport === "tablet" || viewport === "desktop") return viewport;
    if (typeof window === "undefined") return "desktop";
    const w = window.innerWidth;
    if (w < 768) return "mobile";
    if (w < 1080) return "tablet";
    return "desktop";
  });

  useEffect(() => {
    if (viewport !== "auto") {
      setEffective(viewport);
      return;
    }
    const compute = () => {
      const w = window.innerWidth;
      if (w < 768) return "mobile";
      if (w < 1080) return "tablet";
      return "desktop";
    };
    const onResize = () => setEffective(compute());
    setEffective(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [viewport]);

  return effective;
}
