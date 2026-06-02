# docz-cli

## 0.8.2

### Patch Changes

- 7e14db2: Fix `cat` and `share cat` so JSON files are output as raw text instead of being parsed by content type.

## 0.8.1

### Patch Changes

- 29d4921: feat: CLI 和 MCP 支持划线评论（--quote）

## 0.8.0

### Minor Changes

- 7eb2728: `<space>` 参数新增 slug 精确匹配和 name 后缀匹配（如「研发」可匹配 `G160-研发`，`tech` 可匹配 slug 为 `tech` 的 space），后缀同时命中多个 space 时抛出 ambiguity 错误以避免静默选择。`docz spaces` 输出末尾新增 slug 列，原有列顺序不变（向后兼容）。Skill 文档（v0.10.0）整体优化：`whoami` 优先认证检查、明确禁止 Agent 推测 space 名、新增 safe edit workflow。

## 0.7.1

### Patch Changes

- bfb5bc5: chore: automate release pipeline via changesets + GitHub Actions

  - Push to `main` opens a "chore: version packages" PR; merging it triggers `npm publish`, git tag, and GitHub Release.
  - `feature-*` branches support beta pre-releases when `.changeset/pre.json` tag is `beta`.
  - CI workflow gates PRs and main pushes on typecheck / lint / test / build.
  - See CONTRIBUTING.md for the full contributor flow.
