# Mobile Web Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Deck usable on mobile by adding a touch-friendly global Top Bar and turning Mission desktop panes into compact, swipeable child pages.

**Architecture:** Keep desktop behavior intact. Shell owns global navigation; Mission owns mobile pane state, pager, swipe guards, and composer placement. Use existing React/TypeScript/CSS/Tailwind patterns and add no dependencies, colors, or fonts.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind utility classes, app shell CSS, Node test runner source-structure tests.

---

## File map

- `apps/deck/src/shared/ui/layout/top-nav.tsx`: add mobile menu state/markup; keep desktop nav and GitHub link, but give the GitHub link a class that mobile CSS hides.
- `apps/deck/src/app/shell/styles.css`: mobile Top Bar, compact shell spacing, Mission mobile mode, compact pager, and sticky composer rules.
- `apps/deck/src/app/shell/root.tsx`: call `useMissionLayout` with active-view and active-session context after `missionView` exists.
- `apps/deck/src/features/mission/hooks/layout.ts`: add `MissionMobilePane`, mobile breakpoint, selected pane, intelligent default, and guarded swipe handlers.
- `apps/deck/src/features/mission/ui/mobile-pager.tsx`: new small Mission-only pager component.
- `apps/deck/src/features/mission/ui/workspace.tsx`: render one pane at a time on mobile, attach swipe handlers, render pager, hide resizers.
- `apps/deck/src/features/mission/ui/page.tsx`: accept optional mouse handlers for swipe start/end.
- `apps/deck/src/features/mission/ui/{chat-pane,sidebar,display-section,inspector}.tsx`: add pane identity attributes.
- `apps/deck/src/features/mission/ui/{plain-messages,logbook-panel,diff-panel,composer}.tsx`: add `data-mission-swipe-lock="true"` where horizontal interaction or text input must not switch panes.
- `apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`: extend source tests for mobile Mission behavior.
- `apps/deck/src/shared/ui/layout/top-nav.test.ts`: new source test for mobile global navigation.

## Task 1: Mobile global Top Bar

**Files:**
- Modify: `apps/deck/src/shared/ui/layout/top-nav.tsx`
- Create: `apps/deck/src/shared/ui/layout/top-nav.test.ts`
- Modify: `apps/deck/src/app/shell/styles.css`

- [ ] **Step 1: Write failing TopNav source test**

Create `apps/deck/src/shared/ui/layout/top-nav.test.ts`:

~~~ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const topNavSource = readFileSync(resolve(currentDir, "top-nav.tsx"), "utf8");
const shellStylesSource = readFileSync(resolve(currentDir, "../../../app/shell/styles.css"), "utf8");

test("mobile top nav uses an explicit menu instead of hover-only navigation", () => {
  assert.match(topNavSource, /const \[mobileMenuOpen, setMobileMenuOpen\] = useState\(false\)/);
  assert.match(topNavSource, /top-nav-menu-trigger/);
  assert.match(topNavSource, /top-nav-mobile-menu/);
  assert.match(topNavSource, /aria-expanded=\{mobileMenuOpen\}/);
});

test("mobile top nav hides github and avoids large blank gutters", () => {
  assert.match(topNavSource, /top-nav-github-link/);
  assert.match(shellStylesSource, /@media \(max-width: 767px\)/);
  assert.match(shellStylesSource, /\.top-nav-github-link\s*{[^}]*display:\s*none;/s);
  assert.match(shellStylesSource, /\.shell\s*{[^}]*padding:\s*64px 12px 20px;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*padding:\s*56px 8px 8px;/s);
});
~~~

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/shared/ui/layout/top-nav.test.ts`

Expected: FAIL because the mobile menu state/classes and CSS rules do not exist.

- [ ] **Step 3: Implement minimal TopNav markup**

In `top-nav.tsx`, add state and a helper near existing state:

~~~tsx
const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

function navigateFromMenu(view: AppView) {
  onNavigate(view);
  setMobileMenuOpen(false);
}
~~~

Add `top-nav-github-link` to the GitHub anchor class and add a mobile menu button inside `.top-nav-actions`:

~~~tsx
<button
  className="top-nav-menu-trigger"
  type="button"
  aria-label="打开全局导航菜单"
  aria-expanded={mobileMenuOpen}
  onClick={() => setMobileMenuOpen((current) => !current)}
>
  ☰
</button>
~~~

After `.top-nav-actions`, render the mobile menu:

~~~tsx
{mobileMenuOpen ? (
  <nav className="top-nav-mobile-menu" aria-label="移动端全局导航">
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        className={`top-nav-mobile-item ${activeView === item.id ? "active" : ""}`}
        onClick={() => navigateFromMenu(item.id)}
      >
        {item.label}
      </button>
    ))}
  </nav>
) : null}
~~~

- [ ] **Step 4: Add mobile TopBar CSS**

Append near existing TopNav styles in `styles.css`:

~~~css
.top-nav-menu-trigger,
.top-nav-mobile-menu {
  display: none;
}

@media (max-width: 767px) {
  .shell { width: 100vw; padding: 64px 12px 20px; }
  .shell.view-sessions { padding: 56px 8px 8px; }
  .top-nav {
    top: 0; left: 0; width: 100vw; min-height: 52px; max-height: none;
    padding: 8px 12px; transform: none; border-radius: 0;
  }
  .top-nav::after, .top-nav-links, .top-nav-github-link { display: none; }
  .top-nav-menu-trigger {
    display: inline-grid; width: 36px; height: 36px; place-items: center;
    border-radius: 999px; background: var(--color-surface-strong); color: var(--color-text);
  }
  .top-nav-mobile-menu {
    position: absolute; top: calc(100% + 8px); right: 12px; display: grid;
    min-width: 180px; gap: 4px; padding: 8px; border: 1px solid var(--color-border);
    border-radius: var(--radius-panel); background: var(--color-surface); box-shadow: var(--shadow-panel);
  }
  .top-nav-mobile-item { padding: 10px 12px; border-radius: 999px; background: transparent; color: var(--color-muted); text-align: left; }
  .top-nav-mobile-item.active,
  .top-nav-mobile-item:hover,
  .top-nav-mobile-item:focus-visible { background: var(--primary-soft); color: var(--primary); }
}
~~~

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/shared/ui/layout/top-nav.test.ts`

Expected: PASS.

Commit:

~~~bash
git add apps/deck/src/shared/ui/layout/top-nav.tsx apps/deck/src/shared/ui/layout/top-nav.test.ts apps/deck/src/app/shell/styles.css
git commit -m "feat：添加移动端全局导航"
~~~

## Task 2: Mission mobile layout state and swipe helpers

**Files:**
- Modify: `apps/deck/src/app/shell/root.tsx`
- Modify: `apps/deck/src/features/mission/hooks/layout.ts`
- Modify: `apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

- [ ] **Step 1: Add failing layout tests**

Append to `chat-pane-layout.test.ts`:

~~~ts
test("mission layout hook exposes mobile pane state and intelligent defaults", () => {
  assert.match(missionLayoutHookSource, /export type MissionMobilePane = "project" \| "chat" \| "display" \| "inspector"/);
  assert.match(missionLayoutHookSource, /MISSION_MOBILE_WIDTH = 768/);
  assert.match(missionLayoutHookSource, /selectedMissionMobilePane/);
  assert.match(missionLayoutHookSource, /setSelectedMissionMobilePane/);
  assert.match(missionLayoutHookSource, /hasActiveSession \? "chat" : "project"/);
});

test("mission layout hook exposes guarded mobile swipe handlers", () => {
  assert.match(missionLayoutHookSource, /startMissionMobileSwipe/);
  assert.match(missionLayoutHookSource, /finishMissionMobileSwipe/);
  assert.match(missionLayoutHookSource, /isMissionSwipeIgnoredTarget/);
  assert.match(missionLayoutHookSource, /textarea, input, select, button, a/);
  assert.match(missionLayoutHookSource, /\[data-mission-swipe-lock="true"\]/);
});
~~~

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: FAIL.

- [ ] **Step 3: Update layout hook**

In `layout.ts`, add:

~~~ts
export type MissionMobilePane = "project" | "chat" | "display" | "inspector";

const MISSION_MOBILE_WIDTH = 768;
const MISSION_MOBILE_SWIPE_THRESHOLD = 48;
const MISSION_MOBILE_PANES: MissionMobilePane[] = ["project", "chat", "display", "inspector"];

type MissionLayoutOptions = { activeView: unknown; hasActiveSession: boolean };

function isMissionSwipeIgnoredTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('textarea, input, select, button, a, [data-mission-swipe-lock="true"]'));
}

function getAdjacentMissionMobilePane(current: MissionMobilePane, direction: -1 | 1) {
  const index = MISSION_MOBILE_PANES.indexOf(current);
  const nextIndex = Math.min(MISSION_MOBILE_PANES.length - 1, Math.max(0, index + direction));
  return MISSION_MOBILE_PANES[nextIndex] ?? current;
}
~~~

Change signature and add state:

~~~ts
export function useMissionLayout(options: MissionLayoutOptions) {
  const { activeView, hasActiveSession } = options;
  const [selectedMissionMobilePane, setSelectedMissionMobilePane] =
    useState<MissionMobilePane>(() => (hasActiveSession ? "chat" : "project"));
  const missionSwipeStartXRef = useRef<number | null>(null);
~~~

After viewport width is known:

~~~ts
const isMissionMobile = missionViewportWidth < MISSION_MOBILE_WIDTH;

useEffect(() => {
  if (!isMissionMobile) return;
  setSelectedMissionMobilePane(hasActiveSession ? "chat" : "project");
}, [activeView, hasActiveSession, isMissionMobile]);

function startMissionMobileSwipe(event: ReactMouseEvent<HTMLElement>) {
  if (!isMissionMobile || isMissionSwipeIgnoredTarget(event.target)) {
    missionSwipeStartXRef.current = null;
    return;
  }
  missionSwipeStartXRef.current = event.clientX;
}

function finishMissionMobileSwipe(event: ReactMouseEvent<HTMLElement>) {
  const startX = missionSwipeStartXRef.current;
  missionSwipeStartXRef.current = null;
  if (startX === null || !isMissionMobile) return;
  const deltaX = event.clientX - startX;
  if (Math.abs(deltaX) < MISSION_MOBILE_SWIPE_THRESHOLD) return;
  setSelectedMissionMobilePane((current) => getAdjacentMissionMobilePane(current, deltaX < 0 ? 1 : -1));
}
~~~

Return `isMissionMobile`, `selectedMissionMobilePane`, `setSelectedMissionMobilePane`, `startMissionMobileSwipe`, and `finishMissionMobileSwipe`.

- [ ] **Step 4: Update root call**

Move `useMissionLayout` below `missionView` creation in `root.tsx`:

~~~tsx
const layout = useMissionLayout({
  activeView: route.activeView,
  hasActiveSession: Boolean(missionView.activeSession),
});
const layoutContext = buildAppLayoutContext(layout);
~~~

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: PASS.

Commit:

~~~bash
git add apps/deck/src/app/shell/root.tsx apps/deck/src/features/mission/hooks/layout.ts apps/deck/src/features/mission/ui/chat-pane-layout.test.ts
git commit -m "feat：添加任务页移动端分栏状态"
~~~

## Task 3: Compact Mission pager

**Files:**
- Create: `apps/deck/src/features/mission/ui/mobile-pager.tsx`
- Modify: `apps/deck/src/features/mission/ui/workspace.tsx`
- Modify: `apps/deck/src/app/shell/styles.css`
- Modify: `apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

- [ ] **Step 1: Add failing pager tests**

Append:

~~~ts
const mobilePagerSource = readFileSync(resolve(currentDir, "mobile-pager.tsx"), "utf8");

test("mission mobile pager is compact and exposes four pane destinations", () => {
  assert.match(mobilePagerSource, /MissionMobilePager/);
  assert.match(mobilePagerSource, /项目/);
  assert.match(mobilePagerSource, /对话/);
  assert.match(mobilePagerSource, /面板/);
  assert.match(mobilePagerSource, /检视/);
  assert.match(shellStylesSource, /\.mission-mobile-pager\s*{[^}]*min-height:\s*44px;/s);
  assert.match(shellStylesSource, /safe-area-inset-bottom/);
  assert.doesNotMatch(mobilePagerSource, /引导|教程|滑动说明/);
});
~~~

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: FAIL.

- [ ] **Step 3: Create pager component**

Create `mobile-pager.tsx`:

~~~tsx
import type { MissionMobilePane } from "../hooks/layout";

type MissionMobilePagerProps = {
  selectedPane: MissionMobilePane;
  onSelectPane: (pane: MissionMobilePane) => void;
};

const ITEMS: Array<{ id: MissionMobilePane; label: string }> = [
  { id: "project", label: "项目" },
  { id: "chat", label: "对话" },
  { id: "display", label: "面板" },
  { id: "inspector", label: "检视" },
];

export function MissionMobilePager({ selectedPane, onSelectPane }: MissionMobilePagerProps) {
  return (
    <nav className="mission-mobile-pager" aria-label="任务分栏导航">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mission-mobile-pager-item ${item.id === selectedPane ? "active" : ""}`}
          aria-current={item.id === selectedPane ? "page" : undefined}
          onClick={() => onSelectPane(item.id)}
        >
          <span className="mission-mobile-pager-dot" aria-hidden="true" />
          <span className="mission-mobile-pager-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
~~~

- [ ] **Step 4: Render pager and hide resizers on mobile**

In `workspace.tsx`, import `MissionMobilePager`, add `mission-mobile-mode` and `mission-mobile-pane-${selectedMissionMobilePane}` to `missionLayoutClassName`, render the pager at the end of `MissionPage`, and guard all `MissionPaneResizer` render sites with `!isMissionMobile`.

- [ ] **Step 5: Add compact pager CSS**

Append:

~~~css
.mission-mobile-pager { display: none; }

@media (max-width: 767px) {
  .mission-mobile-pager {
    position: sticky; bottom: 0; z-index: 5; display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr)); min-height: 44px;
    gap: 4px; padding: 6px 6px max(6px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--color-border); background: var(--color-surface);
  }
  .mission-mobile-pager-item {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    padding: 6px 4px; border-radius: 999px; background: transparent;
    color: var(--color-muted); font-size: 0.78rem;
  }
  .mission-mobile-pager-item.active { background: var(--primary-soft); color: var(--primary); }
  .mission-mobile-pager-dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; opacity: 0.6; }
}
~~~

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: PASS.

Commit:

~~~bash
git add apps/deck/src/features/mission/ui/mobile-pager.tsx apps/deck/src/features/mission/ui/workspace.tsx apps/deck/src/app/shell/styles.css apps/deck/src/features/mission/ui/chat-pane-layout.test.ts
git commit -m "feat：添加任务页移动端分页器"
~~~

## Task 4: Single-pane mobile Mission rendering

**Files:**
- Modify: `apps/deck/src/features/mission/ui/{workspace,chat-pane,sidebar,display-section,inspector}.tsx`
- Modify: `apps/deck/src/app/shell/styles.css`
- Modify: `apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

- [ ] **Step 1: Add failing pane identity tests**

Append:

~~~ts
test("mission mobile mode marks panes with identities and shows one selected pane", () => {
  assert.match(sidebarSource, /data-mission-mobile-pane="project"/);
  assert.match(workspaceSource, /data-mission-mobile-pane="chat"/);
  assert.match(displayPanelSource, /data-mission-mobile-pane="display"/);
  assert.match(inspectorSource, /data-mission-mobile-pane="inspector"/);
  assert.match(shellStylesSource, /mission-mobile-pane-chat \[data-mission-mobile-pane="chat"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-project \[data-mission-mobile-pane="project"\]/);
});
~~~

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add pane identity attributes**

Add these attributes to the pane root elements while preserving existing classes/styles:

~~~tsx
data-mission-mobile-pane="project"
data-mission-mobile-pane="chat"
data-mission-mobile-pane="display"
data-mission-mobile-pane="inspector"
~~~

- [ ] **Step 4: Add single-pane CSS**

Append:

~~~css
@media (max-width: 767px) {
  .mission-mobile-mode {
    display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
    height: calc(100dvh - 64px); min-height: 0; padding: 0;
  }
  .mission-mobile-mode [data-mission-mobile-pane] {
    grid-column: 1; grid-row: 1; display: none; min-width: 0; min-height: 0; width: 100%; height: 100%;
  }
  .mission-mobile-mode.mission-mobile-pane-project [data-mission-mobile-pane="project"],
  .mission-mobile-mode.mission-mobile-pane-chat [data-mission-mobile-pane="chat"],
  .mission-mobile-mode.mission-mobile-pane-display [data-mission-mobile-pane="display"],
  .mission-mobile-mode.mission-mobile-pane-inspector [data-mission-mobile-pane="inspector"] { display: flex; }
  .mission-mobile-mode .mission-mobile-pager { grid-column: 1; grid-row: 2; }
}
~~~

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: PASS.

Commit:

~~~bash
git add apps/deck/src/features/mission/ui/workspace.tsx apps/deck/src/features/mission/ui/chat-pane.tsx apps/deck/src/features/mission/ui/sidebar.tsx apps/deck/src/features/mission/ui/display-section.tsx apps/deck/src/features/mission/ui/inspector.tsx apps/deck/src/app/shell/styles.css apps/deck/src/features/mission/ui/chat-pane-layout.test.ts
git commit -m "feat：移动端任务页单栏显示"
~~~

## Task 5: Swipe guards and compact composer

**Files:**
- Modify: `apps/deck/src/features/mission/ui/{page,workspace,plain-messages,logbook-panel,diff-panel,composer}.tsx`
- Modify: `apps/deck/src/app/shell/styles.css`
- Modify: `apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

- [ ] **Step 1: Add failing swipe/composer tests**

Append:

~~~ts
const diffPanelSource = readFileSync(resolve(currentDir, "diff-panel.tsx"), "utf8");
const composerSource = readFileSync(resolve(currentDir, "composer.tsx"), "utf8");

test("mission workspace attaches mobile swipe handlers and locks horizontal regions", () => {
  assert.match(workspaceSource, /onMouseDown=\{startMissionMobileSwipe\}/);
  assert.match(workspaceSource, /onMouseUp=\{finishMissionMobileSwipe\}/);
  assert.match(plainMessagesSource, /data-mission-swipe-lock="true"/);
  assert.match(logbookPanelSource, /data-mission-swipe-lock="true"/);
  assert.match(diffPanelSource, /data-mission-swipe-lock="true"/);
});

test("mission composer is sticky and swipe-locked on mobile", () => {
  assert.match(composerSource, /mission-composer/);
  assert.match(composerSource, /data-mission-swipe-lock="true"/);
  assert.match(shellStylesSource, /\.mission-mobile-mode \.mission-composer/);
  assert.match(shellStylesSource, /bottom:\s*calc\(44px \+ env\(safe-area-inset-bottom\)\)/);
});
~~~

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: FAIL.

- [ ] **Step 3: Attach page-level swipe handlers**

Update `page.tsx` props with optional mouse handlers and pass them to the `section`. In `workspace.tsx`, pass:

~~~tsx
onMouseDown={startMissionMobileSwipe}
onMouseUp={finishMissionMobileSwipe}
~~~

- [ ] **Step 4: Add swipe locks**

Add `data-mission-swipe-lock="true"` to horizontal scroll or input regions in `plain-messages.tsx`, `logbook-panel.tsx`, `diff-panel.tsx`, and the composer root. Do not change their existing classes.

- [ ] **Step 5: Add compact composer CSS**

Append:

~~~css
@media (max-width: 767px) {
  .mission-mobile-mode .mission-composer {
    position: sticky; bottom: calc(44px + env(safe-area-inset-bottom)); z-index: 6;
    margin: 0; border-radius: var(--radius-panel) var(--radius-panel) 0 0;
    background: var(--color-surface);
  }
  .mission-mobile-mode:focus-within .mission-mobile-pager {
    min-height: 28px; padding-top: 3px; padding-bottom: max(3px, env(safe-area-inset-bottom));
  }
  .mission-mobile-mode:focus-within .mission-mobile-pager-label { display: none; }
}
~~~

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: PASS.

Commit:

~~~bash
git add apps/deck/src/features/mission/ui/page.tsx apps/deck/src/features/mission/ui/workspace.tsx apps/deck/src/features/mission/ui/plain-messages.tsx apps/deck/src/features/mission/ui/logbook-panel.tsx apps/deck/src/features/mission/ui/diff-panel.tsx apps/deck/src/features/mission/ui/composer.tsx apps/deck/src/app/shell/styles.css apps/deck/src/features/mission/ui/chat-pane-layout.test.ts
git commit -m "feat：添加任务页移动端滑动交互"
~~~

## Task 6: Full verification

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter @tiller/deck test -- apps/deck/src/shared/ui/layout/top-nav.test.ts apps/deck/src/features/mission/ui/chat-pane-layout.test.ts`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @tiller/deck lint`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @tiller/deck typecheck`

Expected: PASS.

- [ ] **Step 4: Manual browser checks**

Run: `pnpm dev`, open Deck, and verify:

- 360px: Top Bar visible, GitHub hidden, global menu opens 总览/任务/舰队/设置.
- 360px with no active Mission session: default pane is 项目.
- 360px with active Mission session: default pane is 对话.
- 390px/430px: pager is one compact row and has no onboarding text.
- Textarea focused: pager compresses and swipe does not switch pages.
- Diff/code/log horizontal areas do not switch Mission pages while dragged.
- 768px: no horizontal page overflow.
- 1280px: existing desktop multi-pane layout and resizers still work.

## Self-review checklist

- Spec coverage: global Top Bar, no GitHub on mobile, no large blank Fleet/Settings gutters, Mission child pages, intelligent default, compact pager, swipe guards, and composer positioning are covered.
- Placeholder scan: no placeholders remain.
- Type consistency: `MissionMobilePane`, `selectedMissionMobilePane`, `setSelectedMissionMobilePane`, `isMissionMobile`, `startMissionMobileSwipe`, and `finishMissionMobileSwipe` are defined before use.
- Scope control: no backend, theme, font, storage, or dependency changes.


