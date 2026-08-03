import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const routePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "mission-route.tsx",
);

test("renderMissionRoute forwards diff directory collapse state to the mission worktree", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /collapsedMissionDiffDirectories,[\s\S]*?missionInspectorPaneStyle,/);
  assert.match(
    source,
    /collapsedMissionDiffDirectories=\{collapsedMissionDiffDirectories\}/,
  );
});

test("renderMissionRoute forwards close diff file action", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /closeMissionDiffFile,/);
  assert.match(source, /closeMissionDiffFile=\{closeMissionDiffFile\}/);
});

test("renderMissionRoute forwards all worktrees for scanned worktrees", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /worktrees,/);
  assert.match(source, /worktrees=\{worktrees\}/);
});

test("renderMissionRoute forwards session plans to the mission worktree", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /sessionPlans,/);
  assert.match(source, /sessionPlans=\{sessionPlans\}/);
});

test("renderMissionRoute forwards git error tab bindings", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /missionGitErrorTabOpen,/);
  assert.match(source, /openMissionGitErrorTab,/);
  assert.match(source, /closeMissionGitErrorTab,/);
  assert.match(source, /missionGitErrorTabOpen=\{missionGitErrorTabOpen\}/);
  assert.match(source, /openMissionGitErrorTab=\{openMissionGitErrorTab\}/);
  assert.match(source, /closeMissionGitErrorTab=\{closeMissionGitErrorTab\}/);
});

test("renderMissionRoute forwards mobile pane state", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /isMissionMobile,/);
  assert.match(source, /selectedMissionMobilePane,/);
  assert.match(source, /setSelectedMissionMobilePane,/);
  assert.doesNotMatch(source, /startMissionMobileSwipe/);
  assert.doesNotMatch(source, /trackMissionMobileSwipe/);
  assert.doesNotMatch(source, /finishMissionMobileSwipe/);
  assert.match(source, /isMissionMobile=\{isMissionMobile\}/);
  assert.match(source, /selectedMissionMobilePane=\{selectedMissionMobilePane\}/);
  assert.match(source, /setSelectedMissionMobilePane=\{setSelectedMissionMobilePane\}/);
});

test("renderMissionRoute forwards navigateToView to the mission worktree", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /navigateToView,/);
  assert.match(source, /navigateToView=\{navigateToView\}/);
});
