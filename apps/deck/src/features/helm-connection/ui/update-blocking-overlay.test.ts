import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HelmUpdateState } from "../../../store/facade";
import {
  HelmUpdateBlockingOverlay,
  isHelmUpdateBlocking,
} from "./update-blocking-overlay";

const baseUpdate: HelmUpdateState = {
  status: "restarting",
  currentVersion: "0.1.12",
  latestVersion: "0.1.13",
  targetVersion: "0.1.13",
  updateAvailable: false,
  canUpdate: true,
};

test("Helm update blocks page interaction while installing or restarting", () => {
  assert.equal(isHelmUpdateBlocking({ ...baseUpdate, status: "installing" }), true);
  assert.equal(isHelmUpdateBlocking(baseUpdate), true);
  assert.equal(isHelmUpdateBlocking({ ...baseUpdate, status: "available" }), false);
  assert.equal(isHelmUpdateBlocking({ ...baseUpdate, status: "failed" }), false);
});

test("HelmUpdateBlockingOverlay renders progress and version details", () => {
  const html = renderToStaticMarkup(createElement(HelmUpdateBlockingOverlay, { update: baseUpdate }));

  assert.match(html, /data-helm-update-blocking-overlay/);
  assert.match(html, /data-helm-update-progress/);
  assert.match(html, /aria-valuetext="正在等待新版本启动"/);
  assert.match(html, /Helm 正在重启/);
  assert.match(html, /等待新版本重新连接/);
  assert.match(html, /0\.1\.12 → 0\.1\.13/);
});

test("HelmUpdateBlockingOverlay labels the installing phase", () => {
  const html = renderToStaticMarkup(
    createElement(HelmUpdateBlockingOverlay, {
      update: { ...baseUpdate, status: "installing" },
    }),
  );

  assert.match(html, /aria-valuetext="正在下载并安装更新"/);
});

test("HelmUpdateBlockingOverlay stays absent outside the blocking states", () => {
  const html = renderToStaticMarkup(
    createElement(HelmUpdateBlockingOverlay, {
      update: { ...baseUpdate, status: "up-to-date" },
    }),
  );

  assert.equal(html, "");
});
