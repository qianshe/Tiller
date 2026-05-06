#!/usr/bin/env node
import { TILLER_VERSION, tillerCliHelp, resolveTillerCliAction } from "../cli";

const action = resolveTillerCliAction();

if (action.kind === "help") {
  console.log(tillerCliHelp());
} else if (action.kind === "version") {
  console.log(TILLER_VERSION);
} else if (action.kind === "error") {
  console.error(action.message);
  console.error(tillerCliHelp());
  process.exitCode = 1;
} else {
  await import("../server");
}
