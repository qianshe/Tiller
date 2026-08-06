import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouteErrorBoundary,
  formatRouteCrashNotification,
} from "./route-error-boundary.js";

test("formatRouteCrashNotification keeps the message and top component frames", () => {
  const componentStack = [
    "",
    "    at MissionWorktree (http://localhost:5173/src/a.tsx:1:1)",
    "    at AppRoutes",
    "    at App",
  ].join("\n");

  const text = formatRouteCrashNotification("Maximum update depth exceeded.", componentStack);

  assert.match(text, /^Maximum update depth exceeded\./);
  assert.match(text, /at MissionWorktree/);
  assert.match(text, /at AppRoutes/);
});

test("formatRouteCrashNotification truncates deep component stacks", () => {
  const frames = Array.from({ length: 40 }, (_value, index) => `    at Component${index}`);
  const text = formatRouteCrashNotification("boom", frames.join("\n"));

  assert.match(text, /at Component0/);
  assert.doesNotMatch(text, /at Component20/);
});

test("RouteErrorBoundary renders children when no error captured", () => {
  const boundary = new RouteErrorBoundary({ onError: () => {}, children: "ok-child" });
  assert.equal(boundary.render(), "ok-child");
});

test("RouteErrorBoundary fallback shows crash message and component stack", () => {
  const boundary = new RouteErrorBoundary({ onError: () => {}, children: null });
  boundary.state = {
    error: new Error("Maximum update depth exceeded."),
    componentStack: "\n    at MissionWorktree\n    at AppRoutes",
  };

  const html = renderToStaticMarkup(boundary.render() as never);

  assert.match(html, /Maximum update depth exceeded\./);
  assert.match(html, /at MissionWorktree/);
  assert.match(html, /复制错误详情/);
  assert.match(html, /重试渲染/);
});
