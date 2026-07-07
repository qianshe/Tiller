const PLUGIN_SKILL_PATH =
  /\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/([^/]+)\/skill\.md/iu;
const SYSTEM_SKILL_PATH = /\/skills\/\.system\/([^/]+)\/skill\.md/iu;
const LOCAL_SKILL_PATH = /\/skills\/([^/]+)\/skill\.md/iu;

export function extractCodexSkillNameFromText(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\\/gu, "/");
  const pluginSkill = normalized.match(PLUGIN_SKILL_PATH);
  if (pluginSkill?.[1] && pluginSkill[2]) {
    return `${pluginSkill[1]}:${pluginSkill[2]}`;
  }
  const systemSkill = normalized.match(SYSTEM_SKILL_PATH);
  if (systemSkill?.[1]) {
    return systemSkill[1];
  }
  const localSkill = normalized.match(LOCAL_SKILL_PATH);
  if (localSkill?.[1]) {
    return localSkill[1];
  }
  return undefined;
}

export function formatCodexSkillTitle(skillName: string) {
  return `Skill: ${skillName}`;
}
