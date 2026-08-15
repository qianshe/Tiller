import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isWithinRadialMenu,
  RadialMenu,
  type RadialMenuItem,
} from "./radial-menu";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "radial-menu.tsx"), "utf8");

const items: RadialMenuItem[] = [
  { id: "overview", icon: "home", label: "总览" },
  { id: "sessions", icon: "mission", label: "任务" },
  { id: "agents", icon: "fleet", label: "舰队" },
  { id: "settings", icon: "settings", label: "设置" },
];

test("RadialMenu is opt-in to avoid duplicate primary navigation", () => {
  const html = renderToStaticMarkup(
    createElement(RadialMenu, {
      activeView: "overview",
      items,
      onNavigate: () => undefined,
    }),
  );

  assert.equal(html, "");
});

test("RadialMenu renders controlled navigation items when enabled", () => {
  const html = renderToStaticMarkup(
    createElement(RadialMenu, {
      activeView: "agents",
      items,
      onNavigate: () => undefined,
      enabled: true,
    }),
  );

  assert.match(html, /aria-label="舰队"/);
  assert.match(html, /aria-current="page"/);
});

test("RadialMenu defaults below the top-right GitHub action", () => {
  assert.match(source, /githubActionRight = "clamp\(24px, 4\.2vw, 56px\)"/);
  assert.match(source, /githubActionTop = "clamp\(24px, 3\.6vh, 40px\)"/);
  assert.match(source, /right: `calc\(\$\{githubActionRight\} - 2px\)`/);
  assert.match(source, /top: `calc\(\$\{githubActionTop\} \+ 56px\)`/);
  assert.doesNotMatch(source, /right:\s*24, bottom:\s*24, position:\s*\"fixed\"/);
});

test("RadialMenu active label sits below the center trigger", () => {
  assert.match(source, /style=\{\{ top: 58 \}\}/);
  assert.doesNotMatch(source, /style=\{\{ top: -28 \}\}/);
});

test("RadialMenu chrome follows theme surface tokens", () => {
  assert.match(source, /background: "var\(--surface-elevated\)"/);
  assert.match(source, /color: "var\(--foreground\)"/);
  assert.doesNotMatch(source, /background: "var\(--popover-glass\)"/);
  assert.doesNotMatch(source, /color: "var\(--primary\)"/);
});

test("RadialMenu has keyboard navigation hooks", () => {
  assert.match(source, /onTriggerKeyDown/);
  assert.match(source, /onItemKeyDown/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /Home/);
  assert.match(source, /Escape/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
});

test("RadialMenu expands when the pointer enters the radial hover zone", () => {
  assert.match(source, /data-radial-hover-zone/);
  assert.match(source, /onPointerEnter=\{onHoverPointerEnter\}/);
  assert.match(source, /event\.pointerType === \"mouse\"/);
  assert.match(source, /width: hoverZoneSize,\r?\n\s+height: hoverZoneSize/);
  assert.match(source, /borderRadius: \"50%\"/);
});

test("RadialMenu treats non-element pointer targets as outside", () => {
  assert.equal(isWithinRadialMenu({} as unknown as EventTarget), false);
  assert.equal(
    isWithinRadialMenu({ closest: "not-a-function" } as unknown as EventTarget),
    false,
  );
  assert.equal(
    isWithinRadialMenu({
      closest: (selector: string) => selector === "[data-radial]" ? {} : null,
    } as unknown as EventTarget),
    true,
  );
});

test("RadialMenu has no dependency on v6 mock data", () => {
  assert.doesNotMatch(source, /\.\.\/data\/mock/);
  assert.doesNotMatch(source, /docs\/redesign\/v6/);
});
