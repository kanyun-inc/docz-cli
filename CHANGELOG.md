# docz-cli

## 0.10.0

### Minor Changes

- 164d99d: Add realtime collaborative editing CLI, MCP tools, and bridge support.

## 0.9.0

### Minor Changes

- 1422759: Add image upload: new `image upload <file>` CLI command and `docz_upload_image` MCP tool. Uploads png/jpg/webp (max 5MB) to the server's OSS asset storage and returns a permanent public URL with a ready-to-paste Markdown reference — images don't consume Space quota and are visible in share links and blogs without login.

### Patch Changes

- 4c55641: feat(image): add image upload command and docz_upload_image MCP tool

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
