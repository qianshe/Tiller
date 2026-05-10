import type { CSSProperties, ReactNode, RefObject } from "react";

type MissionPageProps = {
  layoutRef: RefObject<HTMLElement | null>;
  className: string;
  style: CSSProperties;
  children: ReactNode;
};

/**
 * Composition shell for the mission workspace panes.
 */
export function MissionPage({
  layoutRef,
  className,
  style,
  children,
}: MissionPageProps) {
  return (
    <section ref={layoutRef} className={className} style={style}>
      {children}
    </section>
  );
}
