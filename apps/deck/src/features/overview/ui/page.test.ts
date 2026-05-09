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
  assert.match(stylesSource, /landingTelemetryScroll/);
  assert.match(stylesSource, /\.shell\.view-overview/);
  assert.match(stylesSource, /url\("\/landing\/command-deck-bg\.png"\)/);
  assert.match(stylesSource, /\.landing-hero \{/);
  assert.match(stylesSource, /align-items: start;/);
  assert.match(stylesSource, /padding: clamp\(96px, 11vh, 136px\)/);
  assert.match(topNavSource, /top-nav-logo-mark/);
  assert.match(topNavSource, /<svg className="top-nav-logo-mark"/);
  assert.doesNotMatch(topNavSource, /🚀/);
});
