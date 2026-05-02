#!/usr/bin/env node
import { tillerCliHelp, resolveTillerCliAction } from "./cli";

const action = resolveTillerCliAction();

if (action.kind === "help") {
  console.log(tillerCliHelp());
} else if (action.kind === "error") {
  console.error(action.message);
  console.error(tillerCliHelp());
  process.exitCode = 1;
} else {
  await import("./server");
}
