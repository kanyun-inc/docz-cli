## Why

`docz-cli` 0.11.1 只把精确的 `/s/{slug}/f/{fileId}` 识别为稳定短链；目录短链追加子路径后会退化为普通 Space path，可能把读写目标静默解析到根目录 `f/{fileId}/...`。现在需要在不修改服务端的前提下统一 URL 解析，并让目录稳定短链子路径落到 fileId 的 canonical 目录下。

## What Changes

- 统一 `link info` 与普通 CLI 命令的 Docz URL 语法分类，消除 `parseNormalLink` 与 `resolveUrl` 的分叉。
- 将 `/s/{slug}/f/{fileId}/{childPath}` 解析为稳定 fileId 的目录子路径：先通过现有 file-ref API 获取 canonical Space、path 与目录类型，再安全拼接相对子路径。
- 命中 `/s/{slug}/f/` 后不再回退普通 path；fileId 无效、目标不是目录、slug 与 canonical Space 不一致或 child path 非法时，在任何业务请求前失败。
- `link info` 使用现有 file-ref/path diagnostics 输出最终 canonical child path 和文档状态。
- 保持普通 slug path、Space 根路径、legacy URL、query/fragment 以及精确稳定短链兼容。
- 补齐 parser、resolver、命令无副作用和 test-uts 真机回归测试，并添加 changeset；不修改服务端、不发布生产版本。

## Capabilities

### New Capabilities

- `stable-link-child-path-resolution`: CLI 对目录稳定短链子路径进行 canonical 解析、路径安全校验和命令级一致处理，包含 `link info` 的最终目标诊断。

### Modified Capabilities

- 无。当前仓库尚无已归档到 `openspec/specs/` 的 capability；`link info` 的新增行为纳入上述新 capability。

## Impact

- 主要代码：`src/commands.ts`、`src/commands.test.ts`，必要时补充 `src/client.test.ts`。
- 现有 API：仅复用 `GET /api/file-refs/:id`、file-ref diagnostic 与 path diagnostic；无服务端、数据库或协议变更。
- 命令范围：`link info`、`ls/cat/upload/write/mkdir/rm/mv/log/rollback/restore/comment/share/shortlink/collab/diff` 的 URL target 解析。
- 兼容性：`/s/{slug}/f/...` 被保留为稳定引用路由；真实根目录 `f/...` 仍可通过无歧义的 `space:path` 访问。
- 关联 Claroflow Task：`3112`（修复 docz-cli 目录稳定短链子路径解析）。

## Reference

- 复现 URL：`https://docz.zhenguanyu.com/s/rd/f/nibMkBMl/probe-do-not-create.md`
- 实施基线：`origin/main` commit `b53f23e`，`docz-cli`/tag `0.11.1`；该基线已包含 Task 2363 的 `link info` 能力。
- 本变更为技术修复，Epic 未关联 PRD，按 schema 约定不创建 `prd/`。
