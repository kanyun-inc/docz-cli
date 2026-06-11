# Proposal: docz-cli 支持图片上传（image upload 命令 + MCP 工具 docz_upload_image）

> 关联 Claroflow task：[1030] docz-cli 支持图片上传：image upload 命令 + MCP 工具 docz_upload_image

## Why

AI agent 通过 MCP 写 Docz 文档时有配图需求（截图、生成的图表等），但 docz-cli 目前没有图片上传能力：Markdown 里只能引用外部 URL 或手工走 Web 编辑器上传。服务端已有 `/api/assets/images` OSS 图床接口（Web 编辑器与博客在用），docz-cli 只缺封装。

## What Changes

- `src/client.ts` 新增 `uploadImage()` 方法，封装 `POST /api/assets/images`（multipart，复用现有 Bearer token 鉴权）
- `src/commands.ts` 新增 CLI 命令 `image upload <file>`，输出 OSS 公网 URL 与可直接粘贴的 Markdown 引用
- `src/mcp.ts` 新增 MCP 工具 `docz_upload_image`（入参：本地图片绝对路径），供 AI agent 写文档时配图
- 客户端前置校验：仅支持 png/jpg/jpeg/webp，最大 5MB（与服务端限制一致），不合规不发请求
- 更新 `README.md` 与 `skills/SKILL.md` 文档
- 服务端零改动

## Capabilities

### New Capabilities

- `image-upload`: 上传本地图片到 OSS 图床，返回永久公网 URL（不占 Space 配额，分享链接/博客无登录可见），覆盖 CLI 命令与 MCP 工具两种入口

### Modified Capabilities

（无 —— 本仓库 openspec/specs/ 尚无已有 spec）

## Impact

- 代码：`src/client.ts`、`src/commands.ts`、`src/mcp.ts`、`src/client.test.ts`、`src/commands.test.ts`
- 文档：`README.md`、`skills/SKILL.md`
- API 依赖：DocSync 服务端 `POST /api/assets/images`（已存在，JWT/API Token 均可鉴权）；生产环境已配置 OSS `public_base_url`，返回公网 URL
- 发布：npm minor 版本（changeset），MCP 用户通过 `docz-cli@latest` 自动获得新工具

## Reference

- Epic 未挂 doczLinks，无 PRD 落盘；需求来源为会话内确认的三点：1) 场景是 AI agent 通过 MCP 写文档时配图；2) 图片需在分享链接/博客等无登录态场景可见；3) 形态为 `image upload` 命令 + `docz_upload_image` MCP 工具
- 服务端接口实现：conan-docz `server/internal/handler/asset_image.go`
