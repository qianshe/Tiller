export type PromptEnhancerPreferences = {
  enabled: boolean;
  instruction: string;
  modelProfile: string;
  responseContract: string;
};

export function buildEnhancedPrompt(rawPrompt: string, preferences: PromptEnhancerPreferences) {
  if (!preferences.enabled) {
    return rawPrompt;
  }

  const sections = ["# 标准提示词增强上下文"];
  const instruction = preferences.instruction.trim();
  const modelProfile = preferences.modelProfile.trim();
  const responseContract = preferences.responseContract.trim();

  if (instruction) {
    sections.push(["## 角色与目标", instruction].join("\n"));
  }
  if (modelProfile) {
    sections.push(["## 模型与推理偏好", modelProfile].join("\n"));
  }
  if (responseContract) {
    sections.push(["## 输出契约", responseContract].join("\n"));
  }
  sections.push(["## 用户原始指令", rawPrompt.trim()].join("\n"));

  return sections.join("\n\n");
}
