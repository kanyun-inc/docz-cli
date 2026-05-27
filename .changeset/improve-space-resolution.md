---
"docz-cli": minor
---

`<space>` 参数新增 slug 精确匹配和 name 后缀匹配（如「研发」可匹配 `G160-研发`，`tech` 可匹配 slug 为 `tech` 的 space），后缀同时命中多个 space 时抛出 ambiguity 错误以避免静默选择。`docz spaces` 输出末尾新增 slug 列，原有列顺序不变（向后兼容）。Skill 文档（v0.10.0）整体优化：`whoami` 优先认证检查、明确禁止 Agent 推测 space 名、新增 safe edit workflow。
