import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlashCommandPopup } from "./slash-command-popup";

const currentDir = dirname(fileURLToPath(import.meta.url));
const slashCommandPopupSource = readFileSync(
  resolve(currentDir, "slash-command-popup.tsx"),
  "utf8",
);

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

test("slash command popup renders scope and argument hints", () => {
  const html = renderToStaticMarkup(
    createElement(SlashCommandPopup, {
      commands: [
        {
          name: "frontend-design",
          kind: "skill",
          source: "global",
          scope: "skills",
          input: { hint: "<brief>" },
        },
      ],
      selectedIndex: 0,
      onSelect: () => undefined,
      onHover: () => undefined,
    }),
  );

  assert.match(html, /\/skills:frontend-design/);
  assert.match(html, /global/);
  assert.match(html, /&lt;brief&gt;/);
});

test("slash command popup scrolls the keyboard-selected option into view", () => {
  assert.match(
    slashCommandPopupSource,
    /scrollIntoView\(\{\s*block:\s*"nearest",\s*inline:\s*"nearest"/s,
  );
});
