#!/usr/bin/env node
import { getDefaultConfigPath, readTillerConfig } from "@tiller/agent-registry";
import { TILLER_VERSION, tillerCliHelp, resolveTillerCliAction } from "../cli";
import {
  buildUpdateNotice,
  formatExplicitUpdateOutput,
  loadUpdateVersions,
  resolveUpdateOptions,
} from "../updates/check.js";
import { runLatestUpdate } from "../updates/installer.js";

const action = resolveTillerCliAction();

if (action.kind === "help") {
  console.log(tillerCliHelp());
} else if (action.kind === "version") {
  console.log(TILLER_VERSION);
} else if (action.kind === "error") {
  console.error(action.message);
  console.error(tillerCliHelp());
  process.exitCode = 1;
} else if (action.kind === "update") {
  try {
    const config = readTillerConfig(getDefaultConfigPath());
    const options = resolveUpdateOptions({ env: process.env, config });
    const notice = buildUpdateNotice(await loadUpdateVersions(TILLER_VERSION, { force: true }), options);
    console.log(formatExplicitUpdateOutput(notice));
    if (notice.kind === "latest-update") {
      process.exitCode = await runLatestUpdate();
    }
  } catch (error) {
    console.error(
      `Failed to update Tiller: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("You can update manually with:");
    console.error("  npm install -g @qianshe/tiller@latest");
    process.exitCode = 1;
  }
} else {
  await import("../server");
}
