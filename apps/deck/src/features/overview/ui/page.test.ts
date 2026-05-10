import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(currentDir, "page.tsx");
const stylesPath = resolve(currentDir, "page.css");
const topNavPath = resolve(currentDir, "../../../shared/ui/layout/top-nav.tsx");

test("overview page uses the starship landing hero treatment", () => {
  const pageSource = readFileSync(pagePath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");
  const topNavSource = readFileSync(topNavPath, "utf8");

  assert.match(pageSource, /className="landing-hero"/);
  assert.match(pageSource, /AI COMMAND PLATFORM/);
  assert.match(pageSource, /Command AI\.\s*<br\s*\/?>\s*One Deck\./s);
  assert.match(pageSource, /landing-telemetry-track/);
  assert.match(pageSource, /landing-ship-hotspots/);
  assert.match(pageSource, /landing-ship-hotspot-sessions/);
  assert.match(pageSource, /data-tooltip="任务"/);
  assert.match(pageSource, /data-tooltip="舰队"/);
  assert.match(pageSource, /data-tooltip="设置"/);
  assert.match(pageSource, /onNavigate\("sessions"\)/);
  assert.match(pageSource, /onNavigate\("agents"\)/);
  assert.match(pageSource, /onNavigate\("settings"\)/);
  assert.match(stylesSource, /landingTelemetryScroll/);
  assert.match(stylesSource, /\.shell\.view-overview/);
  assert.match(stylesSource, /url\("\/landing\/command-deck-bg\.png"\)/);
  assert.match(
    stylesSource,
    /background:\s*url\("\/landing\/command-deck-bg\.png"\) center \/ cover no-repeat;/u,
  );
  assert.doesNotMatch(
    stylesSource,
    /\.shell\.view-overview\s*\{[^}]*background:\s*linear-gradient/u,
  );
  assert.match(stylesSource, /\.landing-hero \{/);
  assert.match(stylesSource, /align-items: start;/);
  assert.match(stylesSource, /\.shell\.view-overview > \.top-nav \.top-nav-links \{\s*display: none;/s);
  assert.match(stylesSource, /padding-top: clamp\(44px, 7vh, 76px\)/);
  assert.match(stylesSource, /max-width: 1280px/);
  assert.match(stylesSource, /max-width: 860px/);
  assert.match(stylesSource, /margin-left: clamp\(120px, 10\.8vw, 220px\)/);
  assert.match(stylesSource, /border: 0;/);
  assert.match(stylesSource, /content: attr\(data-tooltip\)/);
  assert.match(stylesSource, /\.landing-ship-hotspot:hover::after/);
  assert.match(stylesSource, /background: transparent;/);
  assert.match(stylesSource, /\.landing-ship-hotspot-sessions/);
  assert.match(stylesSource, /\.landing-ship-hotspot-agents/);
  assert.match(stylesSource, /\.landing-ship-hotspot-settings/);
  assert.match(stylesSource, /@media \(max-width: 1180px\)/);
  assert.match(stylesSource, /@media \(max-width: 720px\)/);
  assert.match(stylesSource, /\.shell\.view-overview\s*{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
  assert.match(stylesSource, /\.landing-hero\s*{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
  assert.match(stylesSource, /landingJetPulse/);
  assert.match(topNavSource, /TILLER_REPOSITORY_URL = "https:\/\/github\.com\/qianshe\/Tiller"/);
  assert.match(topNavSource, /aria-label="打开 Tiller GitHub 仓库"/);
  assert.match(topNavSource, /top-nav-logo-mark/);
  assert.match(topNavSource, /<svg className="top-nav-logo-mark"/);
  assert.match(topNavSource, /cornfield-chase-hans-zimmer\.mp3/);
  assert.match(topNavSource, /landing-cd-player/);
  assert.match(topNavSource, /aria-label=\{isMusicPlaying \? "暂停首页音乐" : "播放首页音乐"\}/);
  assert.doesNotMatch(topNavSource, /Ⅱ/);
  assert.match(stylesSource, /\.shell\.view-overview > \.top-nav \.top-nav-actions/);
  assert.match(stylesSource, /\.shell\.view-overview > \.top-nav \.admiral-avatar \{[\s\S]*?color: #f8fbff;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.match(stylesSource, /\.shell\.view-overview > \.top-nav \.landing-cd-player[\s\S]*?width: 46px;[\s\S]*?height: 46px;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(topNavSource, /☭/);
  assert.doesNotMatch(topNavSource, /🚀/);
});
