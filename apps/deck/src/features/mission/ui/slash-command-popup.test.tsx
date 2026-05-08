import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SlashCommandPopup } from "./slash-command-popup.js";

test("slash command popup renders a single-column command palette with inline kind badges", () => {
  const html = renderToStaticMarkup(
    <SlashCommandPopup
      commands={[
        { name: "ralph-loop", description: "(builtin) Start self-referential loop.", kind: "builtin" },
        { name: "frontend-design", description: "Use this skill for polished UI.", kind: "skill" },
      ]}
      selectedIndex={0}
      onSelect={() => {}}
      onHover={() => {}}
    />,
  );

  assert.match(html, /absolute bottom-full left-0 z-50 mb-2/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-label="\/ralph-loop"/);
  assert.match(html, />\/ralph-loop</);
  assert.match(html, />builtin</);
  assert.match(html, />\/frontend-design</);
  assert.match(html, />skill</);
  assert.match(html, /Start self-referential loop/);
  assert.doesNotMatch(html, /<aside/);
  assert.doesNotMatch(html, /w-56/);
});

