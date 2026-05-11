import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const topNavSource = readFileSync(resolve(currentDir, "top-nav.tsx"), "utf8");
const shellStylesSource = readFileSync(
  resolve(currentDir, "../../../app/shell/styles.css"),
  "utf8",
);

test("mobile top nav uses an explicit menu instead of hover-only navigation", () => {
  assert.match(
    topNavSource,
    /const \[mobileMenuOpen, setMobileMenuOpen\] = useState\(false\)/,
  );
  assert.match(topNavSource, /top-nav-menu-trigger/);
  assert.match(topNavSource, /top-nav-mobile-menu/);
  assert.match(topNavSource, /aria-expanded=\{mobileMenuOpen\}/);
  assert.match(topNavSource, /const navRef = useRef<HTMLElement>\(null\)/);
  assert.match(topNavSource, /document\.addEventListener\("pointerdown", closeMobileMenuOnOutsidePointer\)/);
  assert.match(topNavSource, /navRef\.current\?\.contains\(target\)/);
  assert.match(topNavSource, /useEffect\(\(\) => \{\s*setMobileMenuOpen\(false\);\s*\}, \[activeView\]\)/s);
});

test("mobile top nav hides github and avoids large blank gutters", () => {
  assert.match(topNavSource, /top-nav-github-link/);
  assert.match(shellStylesSource, /@media \(max-width: 1080px\)/);
  assert.match(
    shellStylesSource,
    /\.top-nav \.top-nav-github-link\s*{[^}]*display:\s*none;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell\s*{[^}]*padding:\s*64px 12px 20px;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell\.view-sessions\s*{[^}]*padding:\s*56px 8px 8px;/s,
  );
});

test("brand mark and title navigate back to overview", () => {
  assert.match(topNavSource, /<button\s+className="top-nav-brand"/);
  assert.match(topNavSource, /aria-label="返回首页"/);
  assert.match(topNavSource, /onNavigate\("overview"\)/);
  assert.match(topNavSource, /event\.currentTarget\.blur\(\)/);
  assert.match(shellStylesSource, /\.top-nav-brand\s*{[^}]*background:\s*transparent;/s);
  assert.match(shellStylesSource, /\.top-nav-brand:focus-visible\s*{[^}]*outline:\s*2px solid var\(--primary\);/s);
});

test("mobile overview keeps github as the top-right action", () => {
  assert.match(topNavSource, /const showGlobalMenu = activeView !== "overview"/);
  assert.match(topNavSource, /top-nav-github-link-mobile-visible/);
  assert.match(topNavSource, /\{showGlobalMenu \? \(/);
  assert.match(
    shellStylesSource,
    /\.top-nav \.top-nav-github-link\.top-nav-github-link-mobile-visible\s*{[^}]*display:\s*inline-grid;/s,
  );
});

