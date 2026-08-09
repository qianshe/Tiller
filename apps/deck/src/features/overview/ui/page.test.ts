import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(currentDir, "page.tsx");
const stylesPath = resolve(currentDir, "page.css");

test("overview page uses the starship landing hero treatment", () => {
  const pageSource = readFileSync(pagePath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");

  assert.match(pageSource, /className="landing-hero"/);
  assert.match(pageSource, /landing-github-link-desktop/);
  assert.match(pageSource, /AI COMMAND PLATFORM/);
  assert.match(pageSource, /把本地 AI Agent 代理/);
  assert.match(pageSource, /整理成一个指挥台/);
  assert.match(pageSource, /进入工作台/);
  assert.match(pageSource, /查看控制台/);
  assert.match(pageSource, /onNavigate\("sessions"\)/);
  assert.match(pageSource, /onNavigate\("dashboard"\)/);
  assert.match(pageSource, /在线 HELM/);
  assert.match(pageSource, /项目/);
  assert.match(pageSource, /会话/);
  assert.doesNotMatch(pageSource, /DashboardSection/);
  assert.doesNotMatch(pageSource, /buildOverviewMetrics/);
  assert.doesNotMatch(pageSource, /landing-hero-mobile/);
  assert.doesNotMatch(pageSource, /landing-copy-mobile/);
  assert.doesNotMatch(stylesSource, /\.landing-hero-mobile/);
  assert.doesNotMatch(stylesSource, /\.landing-copy-mobile/);
  assert.doesNotMatch(pageSource, /recent\.length === 0/);
  assert.doesNotMatch(pageSource, /wb-pane[\s\S]*最近任务/);

  assert.match(stylesSource, /\.landing-meta/);
  assert.match(stylesSource, /\.landing-meta-item/);
  assert.match(stylesSource, /\.landing-github-link/);
  assert.match(stylesSource, /url\("\/landing\/command-deck-bg\.png"\)/);
  assert.match(
    stylesSource,
    /background:\s*url\("\/landing\/command-deck-bg\.png"\) center \/ cover no-repeat;/u,
  );
  assert.doesNotMatch(stylesSource, /\.shell\.view-overview/);
  assert.match(stylesSource, /\.landing-hero \{/);
  assert.match(stylesSource, /color: #080d18;/);
  assert.match(stylesSource, /background: linear-gradient\(180deg, rgb\(248 250 252 \/ 0\)/);
  assert.match(stylesSource, /body\[data-theme="light"\] \.landing-hero::before/);
  assert.match(stylesSource, /body\[data-theme="light"\] \.landing-eyebrow/);
  assert.match(stylesSource, /body\[data-theme="light"\] \.landing-hero h1/);
  assert.match(stylesSource, /body\[data-theme="light"\] \.landing-copy/);
  assert.match(stylesSource, /body\[data-theme="dark"\] \.landing-hero::before/);
  assert.match(stylesSource, /rgb\(7 11 24 \/ 0\.42\)/);
  assert.match(stylesSource, /body\[data-theme="harbor"\] \.landing-hero::before/);
  assert.match(stylesSource, /body\[data-theme="voyage"\] \.landing-hero::before/);
  assert.match(stylesSource, /body\[data-theme="chart"\] \.landing-hero::before/);
  assert.doesNotMatch(stylesSource, /data-theme="tiller"/);
  assert.match(stylesSource, /rgb\(11 18 38 \/ 0\.32\)/);
  assert.doesNotMatch(stylesSource, /\.shell\.theme-light \.landing-hero h1/);
  assert.doesNotMatch(stylesSource, /\.shell\.theme-light \.landing-copy/);
  assert.match(stylesSource, /align-items: start;/);
  assert.match(stylesSource, /padding-top: clamp\(20px, 4vh, 56px\)/);
  assert.match(stylesSource, /max-width: 860px/);
  assert.match(stylesSource, /margin-left: clamp\(40px, 8vw, 180px\)/);
  assert.match(stylesSource, /border: 0;/);
  assert.match(stylesSource, /content: attr\(data-tooltip\)/);
  assert.match(stylesSource, /\.landing-ship-hotspot:hover::after/);
  assert.match(stylesSource, /background: transparent;/);
  assert.match(stylesSource, /\.landing-ship-hotspot-sessions/);
  assert.match(stylesSource, /\.landing-ship-hotspot-agents/);
  assert.match(stylesSource, /\.landing-ship-hotspot-settings/);
  assert.match(stylesSource, /@media \(max-width: 1180px\)/);
  assert.match(stylesSource, /@media \(max-width: 720px\)/);
  assert.match(stylesSource, /\.landing-hero\s*{[^}]*align-content:\s*center;[^}]*padding:\s*20px 16px 24px;/s);
  assert.match(stylesSource, /\.landing-hero-content\s*{[^}]*padding-top:\s*0;[^}]*transform:\s*translateY\(-4vh\);/s);
  assert.match(stylesSource, /\.landing-github-link-mobile\s*{[^}]*position:\s*absolute;[^}]*top:\s*24px;[^}]*left:\s*16px;[^}]*z-index:\s*4;/s);
});
