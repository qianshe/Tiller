import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ProjectSummary } from "@tiller/shared";
import {
  deleteProjectYaml,
  ensureTillerConfigDefaults,
  getDefaultConfigPath,
  listAvailableProviders,
  listAvailableProjects,
  readTillerConfig,
  readProjectYaml,
  saveLoggingToConfig,
  saveProviderToConfig,
  saveProjectYaml,
} from "./registry.js";

function createConfigPath() {
  return join(mkdtempSync(join(tmpdir(), "tiller-registry-")), "config.json");
}

function createXdgConfigPath() {
  return join(mkdtempSync(join(tmpdir(), "tiller-registry-")), ".config", "tiller", "config.json");
}

type ProjectWithSummaryFile = ProjectSummary & { summaryFile?: string };

test("getDefaultConfigPath uses the xdg tiller config directory", () => {
  assert.equal(getDefaultConfigPath(), join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".config", "tiller", "config.json"));
});

test("ensureTillerConfigDefaults migrates the legacy .tiller directory to xdg config", () => {
  const configPath = createXdgConfigPath();
  const root = dirname(dirname(dirname(configPath)));
  const legacyConfigPath = join(root, ".tiller", "config.json");
  mkdirSync(dirname(legacyConfigPath), { recursive: true });
  writeFileSync(
    legacyConfigPath,
    JSON.stringify({ daemon: { host: "0.0.0.0", port: 47631 } }),
    "utf8",
  );

  ensureTillerConfigDefaults(configPath);

  assert.equal(existsSync(legacyConfigPath), false);
  assert.equal(existsSync(configPath), true);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).daemon.host, "0.0.0.0");
});

test("readTillerConfig preserves logging options", () => {
  const configPath = createConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ logging: { level: "warn", format: "pretty", acpTrace: "off" } }),
    "utf8",
  );

  assert.deepEqual(readTillerConfig(configPath).logging, {
    level: "warn",
    format: "pretty",
    acpTrace: "off",
  });
});

test("saveLoggingToConfig omits empty global arrays", () => {
  const configPath = createConfigPath();

  saveLoggingToConfig({ level: "warn", format: "pretty", acpTrace: "off" }, configPath);

  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
    logging: { level: "warn", format: "pretty", acpTrace: "off" },
  });
});

test("saveProviderToConfig omits generated provider defaults and legacy install hints", () => {
  const configPath = createConfigPath();

  saveProviderToConfig(
    ({
      id: "codex",
      name: "Codex",
      kind: "custom",
      command: "codex-acp",
      args: [],
      transport: "stdio",
      protocol: "acp",
      installHint: "请确认命令 `codex-acp` 可以在终端运行。",
      capabilities: {
        sessionConfig: {
          model: "startup",
          reasoningEffort: "startup",
          modelFormat: "model",
        },
      },
    } as Parameters<typeof saveProviderToConfig>[0] & { installHint: string }),
    configPath,
  );

  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).agents, [
    {
      id: "codex",
      name: "Codex",
      kind: "custom",
      command: "codex-acp",
      transport: "stdio",
      protocol: "acp",
    },
  ]);
  assert.deepEqual(listAvailableProviders(configPath)[0]?.capabilities?.sessionConfig, {
    model: "startup",
    reasoningEffort: "startup",
    modelFormat: "model",
  });
});

test("saveProviderToConfig preserves non-default capabilities", () => {
  const configPath = createConfigPath();

  saveProviderToConfig(
    {
      id: "custom-agent",
      name: "Custom Agent",
      kind: "custom",
      command: "custom-acp",
      transport: "stdio",
      protocol: "acp",
      capabilities: {
        sessionLoad: true,
        imageInput: true,
      },
    },
    configPath,
  );

  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).agents[0]?.capabilities, {
    sessionLoad: true,
    imageInput: true,
  });
});

test("saveProjectYaml stores generic project ids under the project name", () => {
  const configPath = createConfigPath();

  const result = saveProjectYaml(
    { id: "project-1", name: "Tiller", helmId: "local-helm" },
    configPath,
  );

  assert.equal(result.configPath, join(dirname(configPath), "projects", "Tiller", "project.yaml"));
  assert.equal(existsSync(join(dirname(configPath), "projects", "project-1", "project.yaml")), false);
  assert.equal(readProjectYaml("project-1", configPath).name, "Tiller");
});

test("saveProjectYaml strips generated semantic summaries", () => {
  const configPath = createConfigPath();
  const generatedSummary = [
    "Project: Tiller",
    "",
    "Configured summary: Project: Tiller Worktree: main Path: D:/repo README.md: # Tiller",
    "",
    "Worktree: main",
    "",
    "Path: D:/repo",
    "",
    "README.md:",
    "# Tiller",
  ].join("\n");

  const generated = saveProjectYaml(
    {
      id: "project-2",
      name: "Tiller",
      helmId: "local-helm",
      path: "D:/repo",
      summary: generatedSummary,
    },
    configPath,
  );
  assert.equal(generated.project.summary, undefined);
  assert.equal(readProjectYaml("project-2", configPath).summary, undefined);

  const configured = saveProjectYaml(
    {
      id: "project-4",
      name: "tiller-test-sandbox",
      helmId: "local-helm",
      path: "D:/sandbox",
      summary:
        "Project: tiller-test-sandbox Configured summary: 用于 Tiller 测试的空项目。 Worktree: main Path: D:/sandbox README.md: # sandbox",
    },
    configPath,
  );
  assert.equal(configured.project.summary, "用于 Tiller 测试的空项目。");
});

test("saveProjectYaml persists a normalized summary file path", () => {
  const configPath = createConfigPath();

  const result = saveProjectYaml(
    {
      id: "project-2",
      name: "Tiller",
      helmId: "local-helm",
      path: "D:/repo",
      summaryFile: "docs\\AGENTS.md",
    } as ProjectWithSummaryFile,
    configPath,
  );

  assert.equal((result.project as ProjectWithSummaryFile).summaryFile, "docs/AGENTS.md");
  assert.equal((readProjectYaml("project-2", configPath) as ProjectWithSummaryFile).summaryFile, "docs/AGENTS.md");
});

test("saveProjectYaml omits unsafe summary file paths", () => {
  const configPath = createConfigPath();

  const absolute = saveProjectYaml(
    {
      id: "project-2",
      name: "Tiller",
      helmId: "local-helm",
      summaryFile: "C:/Users/qjq/.ssh/config",
    } as ProjectWithSummaryFile,
    configPath,
  );
  assert.equal((absolute.project as ProjectWithSummaryFile).summaryFile, undefined);

  const posixAbsolute = saveProjectYaml(
    {
      id: "project-4",
      name: "Posix",
      helmId: "local-helm",
      summaryFile: "/etc/passwd",
    } as ProjectWithSummaryFile,
    configPath,
  );
  assert.equal((posixAbsolute.project as ProjectWithSummaryFile).summaryFile, undefined);

  const traversal = saveProjectYaml(
    {
      id: "project-3",
      name: "Other",
      helmId: "local-helm",
      summaryFile: "../README.md",
    } as ProjectWithSummaryFile,
    configPath,
  );
  assert.equal((traversal.project as ProjectWithSummaryFile).summaryFile, undefined);
});

test("saveProjectYaml migrates an existing generic project id directory to the project name", () => {
  const configPath = createConfigPath();
  const legacyPath = join(dirname(configPath), "projects", "project-1", "project.yaml");
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, "id: project-1\nname: Tiller\nhelmId: local-helm\n", "utf8");

  const result = saveProjectYaml(
    { id: "project-1", name: "Tiller", helmId: "local-helm" },
    configPath,
  );

  assert.equal(result.configPath, join(dirname(configPath), "projects", "Tiller", "project.yaml"));
  assert.equal(existsSync(legacyPath), false);
  assert.equal(readProjectYaml("project-1", configPath).name, "Tiller");
});

test("listAvailableProjects migrates generic project id directories on load", () => {
  const configPath = createConfigPath();
  const legacyPath = join(dirname(configPath), "projects", "project-1", "project.yaml");
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, "id: project-1\nname: Tiller\nhelmId: local-helm\n", "utf8");

  const projects = listAvailableProjects(configPath);

  assert.equal(projects[0]?.name, "Tiller");
  assert.equal(existsSync(join(dirname(configPath), "projects", "Tiller", "project.yaml")), true);
  assert.equal(existsSync(legacyPath), false);
});

test("deleteProjectYaml removes a migrated generic project id directory", () => {
  const configPath = createConfigPath();
  saveProjectYaml({ id: "project-1", name: "Tiller", helmId: "local-helm" }, configPath);

  const result = deleteProjectYaml("project-1", configPath);

  assert.equal(result.deleted, true);
  assert.equal(existsSync(join(dirname(configPath), "projects", "Tiller", "project.yaml")), false);
});
