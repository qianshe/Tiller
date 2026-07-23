import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usePanelPages } from "./panel-pages.js";

function PanelPagesProbe() {
  const state = usePanelPages();
  return <span>{state.selectedDisplayTabId}</span>;
}

test("panel pages defaults display selection to diff detail", () => {
  const html = renderToStaticMarkup(createElement(PanelPagesProbe));
  assert.match(html, /diff-detail/);
  assert.doesNotMatch(html, />graph</);
});
