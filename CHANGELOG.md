# docz-cli

## 0.12.1

### Patch Changes

- aac8765: Load collaborative Sheet snapshots that contain Univer drawing mutations.

## 0.12.0

### Minor Changes

- 8158bf7: Add live Univer Sheet range reads and writes with canonical Docz path resolution, role-aware access, and explicit SYNCED, FAILED, and UNKNOWN outcomes.

### Patch Changes

- 5955018: Resolve directory stable-link child paths from the fileId's canonical directory and fail closed instead of falling back to a Space-root `f/...` path.

## 0.11.1

### Patch Changes

- 6f1ea94: Fix `ls -R` to display complete recursive paths and limit results to the requested subdirectory.

## 0.11.0

### Minor Changes

- b8af376: Add separate `link info` and `share info` commands for ordinary and shared
  DocSync links, with human-readable and JSON output for link status, document
  status, folder type, permissions, ownership, and share access metadata.
- b8af376: Add `docz local root` to discover the configured DocSync synchronization
  directory without enumerating files, including existence and freshness
  metadata for consent-based, read-only local search with remote-only writes.

### Patch Changes

- b8af376: Clarify that `mv` destinations are complete Space-root-relative paths and
  improve failed and unknown move outcomes with actionable destination context.

## 0.10.1

### Patch Changes

- 1ed4123: Fix `log` commands crashing when the API returns commit history in the `commits` field, and include the commit author in CLI and MCP history output.

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
