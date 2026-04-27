import assert from "node:assert/strict";
import test from "node:test";
import { buildEnhancedPrompt, type PromptEnhancerPreferences } from "./prompt-enhancer.js";

const basePreferences: PromptEnhancerPreferences = {
  enabled: true,
  instruction: "先复述目标，再列出验收。",
  modelProfile: "优先稳健推理。",
  responseContract: "输出结论、验证、下一步。",
};

test("buildEnhancedPrompt returns raw prompt when enhancer is disabled", () => {
  assert.equal(buildEnhancedPrompt("只处理前端设置", { ...basePreferences, enabled: false }), "只处理前端设置");
});

test("buildEnhancedPrompt wraps raw prompt with standard prompt sections", () => {
  const enhanced = buildEnhancedPrompt("继续完善 Settings", basePreferences);

  assert.ok(enhanced.startsWith("# 标准提示词增强上下文"));
  assert.ok(enhanced.includes("## 角色与目标\n先复述目标，再列出验收。"));
  assert.ok(enhanced.includes("## 模型与推理偏好\n优先稳健推理。"));
  assert.ok(enhanced.includes("## 输出契约\n输出结论、验证、下一步。"));
  assert.ok(enhanced.endsWith("## 用户原始指令\n继续完善 Settings"));
});

test("buildEnhancedPrompt skips empty optional sections but keeps the raw instruction", () => {
  const enhanced = buildEnhancedPrompt("保留用户原始内容", {
    enabled: true,
    instruction: "",
    modelProfile: "  ",
    responseContract: "",
  });

  assert.equal(enhanced, "# 标准提示词增强上下文\n\n## 用户原始指令\n保留用户原始内容");
});
