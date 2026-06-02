import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  deleteProjectYaml,
  ensureTillerConfigDefaults,
  getDefaultConfigPath,
  listAvailableProjects,
  readTillerConfig,
  readProjectYaml,
  saveProjectYaml,
} from "./registry.js";

function createConfigPath() {
  return join(mkdtempSync(join(tmpdir(), "tiller-registry-")), "config.json");
}

function createXdgConfigPath() {
  return join(mkdtempSync(join(tmpdir(), "tiller-registry-")), ".config", "tiller", "config.json");
}

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
