# Tiller 移动端 Web 适配设计

日期：2026-05-10
状态：已确认设计方向，待实现计划
范围：Deck Web，重点是 Mission 页；不改主题颜色与字体。

## 目标

让 Tiller 在手机宽度下可用、可恢复任务、可继续对话，并保持宽屏已有工作台体验不退化。

## 非目标

- 不改主题色、字体体系或品牌视觉方向。
- 不重做桌面端多栏布局。
- 不新增移动端独立应用能力。
- 不引入新的外部依赖。

## 设计原则

1. 移动端不压缩桌面多栏，而是把分栏映射为独立子页。
2. Chat 是任务推进中心；项目、面板、检视是围绕 Chat 的辅助上下文。
3. 所有移动端导航必须触屏可见，不依赖 hover。
4. 滑动切页必须避免和输入框、代码块、Diff、日志横向滚动冲突。
5. 宽屏体验保持现状，移动端行为通过断点和局部交互补齐。

## 全局导航

移动端保留全局导航栏，但从当前 hover 展开的 TopNav 改成显式触屏 Top Bar。

Top Bar 内容：

- Tiller 品牌标识。
- 当前全局视图名称，如“任务”。
- Helm 连接状态入口（轻量状态，不显示 GitHub 图标）。
- 右上角菜单按钮。

右上角菜单打开全局菜单/抽屉，包含：

- 总览
- 任务
- 舰队
- 设置

全局 Top Bar 只负责应用级导航，不承载 Mission 子页切换。移动端不展示桌面端 GitHub 圆形图标，避免挤占主导航空间。

## Mission 移动端信息架构

Mission 桌面多栏在手机上变成 4 个可滑动子页：

1. 项目：Helm、项目、Agent、历史会话与新建任务入口。
2. 对话：消息时间线、权限提示、工具状态、Composer。
3. 面板：运行概览、日志、Diff 详情、用户自定义 panel pages。
4. 检视：工作树、变更摘要、辅助检查信息。

子页顺序固定为：

```text
项目 ← 对话 → 面板 → 检视
```

## 默认进入规则

采用智能默认：

- 有 active session，或从任务/通知/历史会话继续进入：默认打开“对话”。
- 无 active session，或首次进入 Mission：默认打开“项目”。

这样兼顾“继续任务”的高频路径和“新建任务”的首次路径。

## Mission 子页导航

移动端 Mission 使用底部紧凑 Pager，不做厚重导航栏，也不做额外引导页。

Pager 展现：

- 高度控制在约 `44px - 52px`，并适配 `safe-area-inset-bottom`。
- 4 个入口为：项目、对话、面板、检视。
- 默认使用短文字或图标 + 短文字；若空间不足，可退化为“圆点 + 当前页短标签”。
- 当前子页只做轻量高亮，不使用大面积说明卡片。
- Chat 页中，Pager 位于 Composer 下方；键盘弹起时 Pager 可压缩为圆点或临时隐藏。

交互规则：

- 点击 Pager 项切换子页。
- 页面级左右拖动切换相邻子页。
- 当前子页在 Pager 上高亮。
- 不增加首次引导、教程遮罩或复杂手势说明；用户通过底部入口和左右滑一次即可理解。
- Pager 是 Mission 局部导航，不替代全局 Top Bar。

## 滑动切页规则

为避免误触，滑动切页需要以下保护：

- 输入框聚焦时禁用左右切页。
- 代码块、Diff、日志、横向滚动容器内不触发切页。
- 优先响应从页面边缘或非交互空白区域开始的横向拖动。
- 垂直滚动意图明确时不切页。
- 拖动距离和速度达到阈值才切页；未达到阈值回弹当前页。

## Composer 输入框

Composer 只在“对话”子页显示。

移动端布局：

- Composer sticky 在 Mission Pager 上方。
- 工具按钮折叠为一行 chip 或“更多”入口。
- Agent、Worktree、Model、Reasoning、Prompt 增强等配置使用底部抽屉。
- 键盘弹起时，Composer 贴近键盘上沿；Mission Pager 可临时收起或压缩为最小可见状态。

## 抽屉分工

主分栏不使用抽屉承载；主分栏都是可滑动子页。

抽屉只用于临时选择或动作：

- Agent 选择
- Worktree 选择
- Model / Reasoning 配置
- 权限确认
- 更多操作

抽屉行为：

- 默认底部半屏。
- 可上拉到全屏。
- 下滑、Esc、返回键或关闭按钮关闭。
- 抽屉打开时暂停页面级左右切页。

## 断点建议

- `>= 1280px`：保留当前桌面多栏与 resizer 体验。
- `768px - 1279px`：平板布局，可保留 Chat + 一个辅助面板的 2 栏，优先自动折叠 inspector/sidebar。
- `< 768px`：进入移动端 Mission 子页模式，隐藏桌面 resizer，多栏变为单页切换。

具体断点应结合现有 `useMissionLayout` 的自动折叠阈值落地，不引入与现有布局冲突的第二套规则。

## 实施边界

建议按最小影响拆分：

1. Shell / TopNav：增加移动端显式 Top Bar 与菜单状态；不改变桌面 hover TopNav。移动端 Top Bar 不显示 GitHub 图标。
2. Mission layout hook：增加移动端模式判断与当前子页状态。
3. Mission workspace：在移动端只渲染/展示当前子页，隐藏 resizer。
4. Mission composer：移动端 sticky 到 Pager 上方，工具配置走抽屉。
5. CSS / Tailwind class：只增加响应式布局规则，不改主题 token。
6. Tests：补充 Mission 移动模式、默认页、切页保护、TopNav 移动行为相关测试。

## 验收标准

- 手机宽度下不出现横向页面溢出。
- Mission 无 active session 时默认进入“项目”。
- Mission 有 active session 时默认进入“对话”。
- 底部紧凑 Pager 可点击切换项目、对话、面板、检视，且不占用过多垂直空间。
- 左右滑动可切换相邻子页。
- 输入框聚焦、抽屉打开、Diff/代码/日志横向滚动时不会误切页。
- Composer 不被底部 Pager 或系统键盘遮挡；键盘弹起时 Pager 可压缩或临时隐藏。
- 全局 Top Bar 在手机上可见，并能打开总览、任务、舰队、设置导航；Top Bar 不显示 GitHub 图标。
- 桌面宽屏布局与现有 resizer 行为不退化。
- 不修改主题颜色与字体 token。
- 舰队、设置等非 Mission 页面不为移动端 Top Bar 额外保留大块空白；只使用必要安全区和内容间距。

## 验证方式

自动化：

- `pnpm --filter @tiller/deck lint`
- `pnpm --filter @tiller/deck typecheck`
- 相关 Node test runner 测试，覆盖移动模式判断和布局约束。

人工/浏览器：

- Chrome DevTools / 浏览器设备模式检查 360px、390px、430px、768px、1280px。
- 验证 Mission 四子页点击与滑动切换。
- 验证输入框聚焦与键盘弹起场景。
- 验证全局 Top Bar 菜单导航。

## 风险与取舍

- 滑动切页和代码/Diff 横向滚动存在手势冲突，必须加保护区和阈值。
- Composer 与底部 Pager 会竞争垂直空间，键盘弹起时需要压缩 Pager。
- 如果一次性改全部页面风险较高，优先交付 Mission 页；Agents、Settings 等页面后续按同一 Top Bar 规则补齐。


