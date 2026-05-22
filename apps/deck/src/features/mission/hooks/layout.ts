import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

export type MissionPaneId = "sidebar" | "chat" | "display" | "inspector";

export type MissionMobilePane = "project" | "chat" | "display" | "inspector";

export type MissionPaneWidths = Record<MissionPaneId, number>;

export type MissionResizeHandle = "sidebar" | "display" | "inspector";

const DEFAULT_MISSION_PANE_WIDTHS: MissionPaneWidths = {
  sidebar: 248,
  chat: 500,
  display: 320,
  inspector: 280,
};
const MISSION_MIN_CHAT_WIDTH = 360;
const MISSION_PANE_LIMITS: Record<
  MissionPaneId,
  { min: number; max?: number }
> = {
  sidebar: { min: 0 },
  chat: { min: MISSION_MIN_CHAT_WIDTH },
  display: { min: 0 },
  inspector: { min: 0 },
};
const MISSION_RESIZER_WIDTH = 4;
const MISSION_OUTER_GUTTER = 16;
const MISSION_AUTO_COLLAPSE_SIDEBAR_WIDTH = 1081;
const MISSION_AUTO_COLLAPSE_DISPLAY_WIDTH = 1081;
const MISSION_MOBILE_WIDTH = 1081;
type MissionLayoutOptions = {
  activeView: unknown;
  hasActiveSession: boolean;
};

function getMissionPaneMax(pane: MissionPaneId) {
  return MISSION_PANE_LIMITS[pane].max ?? Number.POSITIVE_INFINITY;
}

function clampPaneWidth(value: number, pane: MissionPaneId) {
  const limits = MISSION_PANE_LIMITS[pane];
  const max = getMissionPaneMax(pane);
  return Math.min(max, Math.max(limits.min, Math.round(value)));
}

function normalizeMissionPaneWidths(
  widths: MissionPaneWidths,
  sidebarCollapsed: boolean,
  displayCollapsed: boolean,
  inspectorCollapsed: boolean,
  viewportWidth: number,
): MissionPaneWidths {
  const next: MissionPaneWidths = {
    sidebar: sidebarCollapsed ? 0 : clampPaneWidth(widths.sidebar, "sidebar"),
    chat: clampPaneWidth(widths.chat, "chat"),
    display: displayCollapsed ? 0 : clampPaneWidth(widths.display, "display"),
    inspector: inspectorCollapsed
      ? 0
      : clampPaneWidth(widths.inspector, "inspector"),
  };
  const visibleResizerCount =
    (sidebarCollapsed ? 0 : 1) +
    (displayCollapsed ? 0 : 1) +
    (inspectorCollapsed ? 0 : 1);
  const availableWidth = Math.max(
    0,
    viewportWidth -
      MISSION_OUTER_GUTTER -
      visibleResizerCount * MISSION_RESIZER_WIDTH,
  );
  const totalWidth = next.sidebar + next.chat + next.display + next.inspector;

  if (totalWidth < availableWidth) {
    return {
      ...next,
      chat: next.chat + availableWidth - totalWidth,
    };
  }

  let overflow = totalWidth - availableWidth;
  if (overflow <= 0) {
    return next;
  }

  if (!inspectorCollapsed) {
    const inspectorReduction = Math.min(
      overflow,
      Math.max(0, next.inspector - MISSION_PANE_LIMITS.inspector.min),
    );
    next.inspector -= inspectorReduction;
    overflow -= inspectorReduction;
  }

  if (!sidebarCollapsed && overflow > 0) {
    const sidebarReduction = Math.min(
      overflow,
      Math.max(0, next.sidebar - MISSION_PANE_LIMITS.sidebar.min),
    );
    next.sidebar -= sidebarReduction;
    overflow -= sidebarReduction;
  }

  if (!displayCollapsed && overflow > 0) {
    const displayReduction = Math.min(
      overflow,
      Math.max(0, next.display - MISSION_PANE_LIMITS.display.min),
    );
    next.display -= displayReduction;
  }

  return next;
}

function resizeMissionPanePair(
  widths: MissionPaneWidths,
  left: MissionPaneId,
  right: MissionPaneId,
  delta: number,
): MissionPaneWidths {
  const total = widths[left] + widths[right];
  const leftMin = MISSION_PANE_LIMITS[left].min;
  const rightMin = MISSION_PANE_LIMITS[right].min;
  const leftMax = getMissionPaneMax(left);
  const rightMax = getMissionPaneMax(right);
  const lowerLeft = Math.max(leftMin, total - rightMax);
  const upperLeft = Math.min(leftMax, total - rightMin);
  const nextLeft = Math.round(
    Math.min(upperLeft, Math.max(lowerLeft, widths[left] + delta)),
  );
  return {
    ...widths,
    [left]: nextLeft,
    [right]: Math.round(total - nextLeft),
  };
}

function resolveMissionResizePair(
  handle: MissionResizeHandle,
): [MissionPaneId, MissionPaneId] {
  if (handle === "sidebar") {
    return ["sidebar", "chat"];
  }
  if (handle === "display") {
    return ["chat", "display"];
  }
  return ["display", "inspector"];
}

function createMissionPaneStyles(widths: MissionPaneWidths) {
  return {
    layout: {
      "--mission-sidebar-width": `${widths.sidebar}px`,
      "--mission-sidebar-resizer-width": `${widths.sidebar > 0 ? MISSION_RESIZER_WIDTH : 0}px`,
      "--mission-chat-width": `${widths.chat}px`,
      "--mission-display-resizer-width": `${widths.display > 0 ? MISSION_RESIZER_WIDTH : 0}px`,
      "--mission-display-width": `${widths.display}px`,
      "--mission-inspector-resizer-width": `${widths.inspector > 0 ? MISSION_RESIZER_WIDTH : 0}px`,
      "--mission-inspector-width": `${widths.inspector}px`,
    } as CSSProperties,
    sidebar: { flexBasis: `${widths.sidebar}px` } as CSSProperties,
    chat: { flexBasis: `${widths.chat}px` } as CSSProperties,
    display: { flexBasis: `${widths.display}px` } as CSSProperties,
    inspector: { flexBasis: `${widths.inspector}px` } as CSSProperties,
  };
}

function countVisibleMissionResizers(
  sidebarCollapsed: boolean,
  displayCollapsed: boolean,
  inspectorCollapsed: boolean,
) {
  return (
    (sidebarCollapsed ? 0 : 1) +
    (displayCollapsed ? 0 : 1) +
    (inspectorCollapsed ? 0 : 1)
  );
}

function resolveProjectedChatWidth(
  viewportWidth: number,
  sidebarCollapsed: boolean,
  displayCollapsed: boolean,
  inspectorCollapsed: boolean,
) {
  const projectedFixedWidth =
    (sidebarCollapsed ? 0 : DEFAULT_MISSION_PANE_WIDTHS.sidebar) +
    (displayCollapsed ? 0 : DEFAULT_MISSION_PANE_WIDTHS.display) +
    (inspectorCollapsed ? 0 : DEFAULT_MISSION_PANE_WIDTHS.inspector) +
    countVisibleMissionResizers(
      sidebarCollapsed,
      displayCollapsed,
      inspectorCollapsed,
    ) *
      MISSION_RESIZER_WIDTH +
    MISSION_OUTER_GUTTER;

  return viewportWidth - projectedFixedWidth;
}

function shouldCollapseInspectorForChat(
  viewportWidth: number,
  sidebarCollapsed: boolean,
  displayCollapsed: boolean,
  inspectorCollapsed: boolean,
) {
  if (inspectorCollapsed) {
    return false;
  }
  return (
    resolveProjectedChatWidth(
      viewportWidth,
      sidebarCollapsed,
      displayCollapsed,
      false,
    ) < MISSION_MIN_CHAT_WIDTH
  );
}

function shouldCollapseDisplayForChat(
  viewportWidth: number,
  sidebarCollapsed: boolean,
  displayCollapsed: boolean,
  inspectorCollapsed: boolean,
) {
  if (displayCollapsed) {
    return false;
  }
  return (
    resolveProjectedChatWidth(
      viewportWidth,
      sidebarCollapsed,
      false,
      inspectorCollapsed,
    ) < MISSION_MIN_CHAT_WIDTH
  );
}

export function useMissionLayout(options: MissionLayoutOptions) {
  const { activeView, hasActiveSession } = options;
  const [missionPaneWidths, setMissionPaneWidths] = useState<MissionPaneWidths>(
    DEFAULT_MISSION_PANE_WIDTHS,
  );
  const [missionSidebarCollapsed, setMissionSidebarCollapsed] = useState(false);
  const [missionDisplayCollapsed, setMissionDisplayCollapsed] = useState(false);
  const [missionInspectorCollapsed, setMissionInspectorCollapsed] =
    useState(false);
  const [selectedMissionMobilePane, setSelectedMissionMobilePane] =
    useState<MissionMobilePane>(() => (hasActiveSession ? "chat" : "project"));
  const missionLayoutRef = useRef<HTMLElement | null>(null);
  const [missionViewportWidth, setMissionViewportWidth] = useState(() =>
    typeof document === "undefined"
      ? 1440
      : document.documentElement.clientWidth,
  );

  useEffect(() => {
    const measureMissionLayout = () => {
      const documentWidth = Math.min(
        document.documentElement.clientWidth,
        window.innerWidth,
      );
      const layoutWidth =
        missionLayoutRef.current?.getBoundingClientRect().width ?? documentWidth;
      const width = window.matchMedia("(max-width: 1080px)").matches
        ? Math.min(layoutWidth, documentWidth, MISSION_MOBILE_WIDTH - 1)
        : Math.min(layoutWidth, documentWidth);
      setMissionViewportWidth(Math.max(0, Math.round(width)));
    };
    measureMissionLayout();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureMissionLayout);
    if (missionLayoutRef.current) {
      resizeObserver?.observe(missionLayoutRef.current);
    }
    window.addEventListener("resize", measureMissionLayout);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureMissionLayout);
    };
  }, [activeView]);

  const isMissionMobile = missionViewportWidth < MISSION_MOBILE_WIDTH;

  useEffect(() => {
    if (!isMissionMobile) {
      return;
    }
    setSelectedMissionMobilePane(hasActiveSession ? "chat" : "project");
  }, [activeView, hasActiveSession, isMissionMobile]);

  const effectiveSidebarCollapsed =
    missionSidebarCollapsed ||
    missionViewportWidth < MISSION_AUTO_COLLAPSE_SIDEBAR_WIDTH;
  const inspectorCollapsedForChat = shouldCollapseInspectorForChat(
    missionViewportWidth,
    effectiveSidebarCollapsed,
    false,
    missionInspectorCollapsed,
  );
  const effectiveInspectorCollapsed =
    missionInspectorCollapsed || inspectorCollapsedForChat;
  const displayCollapsedForChat = shouldCollapseDisplayForChat(
    missionViewportWidth,
    effectiveSidebarCollapsed,
    missionDisplayCollapsed,
    effectiveInspectorCollapsed,
  );
  const effectiveDisplayCollapsed =
    missionDisplayCollapsed ||
    missionViewportWidth < MISSION_AUTO_COLLAPSE_DISPLAY_WIDTH ||
    displayCollapsedForChat;
  const resolvedMissionPaneWidths = normalizeMissionPaneWidths(
    missionPaneWidths,
    effectiveSidebarCollapsed,
    effectiveDisplayCollapsed,
    effectiveInspectorCollapsed,
    missionViewportWidth,
  );
  const paneStyles = createMissionPaneStyles(resolvedMissionPaneWidths);

  function applyMissionPaneDelta(
    handle: MissionResizeHandle,
    delta: number,
    base: MissionPaneWidths,
  ) {
    const [left, right] = resolveMissionResizePair(handle);
    setMissionPaneWidths(resizeMissionPanePair(base, left, right, delta));
  }

  function startMissionPaneResize(
    handle: MissionResizeHandle,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const base = resolvedMissionPaneWidths;
    const onMove = (moveEvent: MouseEvent) => {
      applyMissionPaneDelta(handle, moveEvent.clientX - startX, base);
    };
    const onUp = () => {
      document.body.classList.remove("mission-pane-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.classList.add("mission-pane-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  }

  function nudgeMissionPane(handle: MissionResizeHandle, direction: -1 | 1) {
    applyMissionPaneDelta(handle, direction * 24, resolvedMissionPaneWidths);
  }

  return {
    missionLayoutRef,
    missionSidebarCollapsed,
    setMissionSidebarCollapsed,
    missionDisplayCollapsed,
    setMissionDisplayCollapsed,
    missionInspectorCollapsed,
    setMissionInspectorCollapsed,
    effectiveSidebarCollapsed,
    effectiveDisplayCollapsed,
    effectiveInspectorCollapsed,
    paneStyles,
    startMissionPaneResize,
    nudgeMissionPane,
    isMissionMobile,
    selectedMissionMobilePane,
    setSelectedMissionMobilePane,
  };
}
