import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SlashCommandPopup } from "./slash-command-popup.js";

test("slash command popup renders a visible command palette with selected details", () => {
  const html = renderToStaticMarkup(
    <SlashCommandPopup
      commands={[
        { name: "update-config", description: "Use this skill to update configuration." },
        { name: "debug", input: { hint: "Debug a failing workflow." } },
      ]}
      selectedIndex={0}
      onSelect={() => {}}
      onHover={() => {}}
    />,
  );

  assert.match(html, /absolute bottom-full left-0 z-50 mb-2/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-label="\/update-config"/);
  assert.match(html, />update-config</);
  assert.match(html, /\/update-config/);
  assert.match(html, /Use this skill to update configuration\./);
});

