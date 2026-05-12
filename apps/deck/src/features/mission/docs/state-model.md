# Mission State Model

Zustand 是 Deck 的浏览器侧共享状态 store，用于保存 sessions、messages、agents、projects、连接状态、权限与偏好等运行时/UI 状态。

高频状态必须使用窄选择器。比如聊天面板只订阅 `messages[activeSessionId]`，不要订阅整个 `messages` map；这样某个 session 的流式消息更新不会迫使无关 UI 跟着重渲染。

Session summaries 属于低频状态。Assistant streaming chunk 只应该更新当前消息视图；会话列表应主要由 status change、user prompt、final assistant checkpoint、title change、permission state 或显式 `session_updated` 更新。
