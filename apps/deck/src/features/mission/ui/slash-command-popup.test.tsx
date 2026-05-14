import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlashCommandPopup } from "./slash-command-popup";

test("slash command popup shows an empty state when provider reports no commands", () => {
  const html = renderToStaticMarkup(
    createElement(SlashCommandPopup, {
      commands: [],
      selectedIndex: 0,
      onSelect: () => undefined,
      onHover: () => undefined,
    }),
  );

  assert.match(html, /暂无可用命令/);
  assert.match(html, /未上报 slash commands/);
});
