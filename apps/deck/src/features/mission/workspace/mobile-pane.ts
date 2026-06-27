export const MISSION_MOBILE_PANE_ORDER = ["project", "chat", "inspector", "display"] as const;

export type MissionMobilePane = typeof MISSION_MOBILE_PANE_ORDER[number];

export function selectAdjacentMissionMobilePane(
  currentPane: MissionMobilePane,
  direction: -1 | 1,
): MissionMobilePane {
  const currentIndex = MISSION_MOBILE_PANE_ORDER.indexOf(currentPane);
  const nextIndex = Math.min(
    MISSION_MOBILE_PANE_ORDER.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return MISSION_MOBILE_PANE_ORDER[nextIndex] ?? currentPane;
}
