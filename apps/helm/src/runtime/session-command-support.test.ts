import assert from "node:assert/strict";
import test from "node:test";
import type { AvailableCommand } from "@tiller/shared";
import {
  assertSupportedSlashCommand,
  availableCommandInvocations,
  parseSlashCommandName,
} from "./session-command-support.js";

test("parseSlashCommandName extracts the first slash command token", () => {
  assert.equal(parseSlashCommandName(" /review now"), "review");
  assert.equal(parseSlashCommandName("//review now"), "review");
  assert.equal(parseSlashCommandName("plain text"), null);
});

test("availableCommandInvocations includes scoped command aliases", () => {
  const command: AvailableCommand = { name: "/review", scope: "git" } as AvailableCommand;

  assert.deepEqual(availableCommandInvocations(command), ["review", "git:review"]);
});

test("assertSupportedSlashCommand rejects unsupported commands with available command hints", () => {
  const commands: AvailableCommand[] = [
    { name: "review", scope: "git" } as AvailableCommand,
  ];

  assert.throws(
    () => assertSupportedSlashCommand("/unknown", commands, "Codex"),
    /\/unknown command is not supported by Codex\. Available commands: \/git:review/u,
  );
});
