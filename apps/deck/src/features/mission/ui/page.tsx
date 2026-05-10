import type {
  CSSProperties,
  PointerEventHandler,
  ReactNode,
  RefObject,
} from "react";

type MissionPageProps = {
  layoutRef: RefObject<HTMLElement | null>;
  className: string;
  style: CSSProperties;
  children: ReactNode;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onPointerUp?: PointerEventHandler<HTMLElement>;
  onPointerCancel?: PointerEventHandler<HTMLElement>;
};

/**
 * Composition shell for the mission workspace panes.
 */
export function MissionPage({
  layoutRef,
  className,
  style,
  children,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: MissionPageProps) {
  return (
    <section
      ref={layoutRef}
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {children}
    </section>
  );
}
