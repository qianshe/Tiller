import assert from "node:assert/strict";
import test from "node:test";
import { resolveTillerCliAction } from "./cli.js";

test("resolveTillerCliAction starts Tiller when no command or start command is provided", () => {
  assert.equal(resolveTillerCliAction([]).kind, "start");
  assert.equal(resolveTillerCliAction(["--port", "49000"]).kind, "start");
  assert.equal(resolveTillerCliAction(["start", "--port", "49000"]).kind, "start");
});

test("resolveTillerCliAction returns help for help flags", () => {
  assert.equal(resolveTillerCliAction(["--help"]).kind, "help");
  assert.equal(resolveTillerCliAction(["help"]).kind, "help");
});

test("resolveTillerCliAction returns version for version flags", () => {
  assert.equal(resolveTillerCliAction(["--version"]).kind, "version");
  assert.equal(resolveTillerCliAction(["-v"]).kind, "version");
});

test("resolveTillerCliAction returns update for update command", () => {
  assert.deepEqual(resolveTillerCliAction(["update"]), { kind: "update" });
});

test("resolveTillerCliAction rejects the removed stop command", () => {
  const action = resolveTillerCliAction(["stop"]);

  assert.equal(action.kind, "error");
  assert.match(action.message, /Unknown command: stop/u);
});

test("resolveTillerCliAction gives help and version flags priority over update", () => {
  assert.equal(resolveTillerCliAction(["update", "--help"]).kind, "help");
  assert.equal(resolveTillerCliAction(["update", "--version"]).kind, "version");
});

test("resolveTillerCliAction rejects unknown commands", () => {
  const action = resolveTillerCliAction(["serve"]);

  assert.equal(action.kind, "error");
  assert.match(action.message, /Unknown command/u);
});
