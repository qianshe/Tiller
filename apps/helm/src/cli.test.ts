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

test("resolveTillerCliAction rejects unknown commands", () => {
  const action = resolveTillerCliAction(["serve"]);

  assert.equal(action.kind, "error");
  assert.match(action.message, /Unknown command/u);
});
