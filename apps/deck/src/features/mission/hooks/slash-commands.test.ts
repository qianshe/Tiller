import assert from "node:assert/strict";
import test from "node:test";
import { formatSlashCommandInvocation, shouldShowSlashCommandPopup } from "./slash-commands";

test("slash popup opens for slash input even when command list is empty", () => {
  assert.equal(
    shouldShowSlashCommandPopup({
      commandToken: "",
      activeSessionAgentId: "codex",
      suppressedFor: null,
      prompt: "/",
    }),
    true,
  );
});

test("slash popup stays closed when current slash prompt was suppressed", () => {
  assert.equal(
    shouldShowSlashCommandPopup({
      commandToken: "",
      activeSessionAgentId: "codex",
      suppressedFor: "/",
      prompt: "/",
    }),
    false,
  );
});

test("formatSlashCommandInvocation includes scope for scoped commands", () => {
  assert.equal(
    formatSlashCommandInvocation({ name: "frontend-design", scope: "skills" }),
    "/skills:frontend-design ",
  );
});
