# Tasks: docz-cli 图片上传

## 1. API 封装（client 层）

- [x] 1.1 `src/client.ts` 新增 `UploadImageResult` 接口与 `uploadImage(content: Buffer, filename: string)` 方法（multipart POST `/api/assets/images`，复用 `request()`）
- [x] 1.2 `src/client.test.ts` 新增 msw 用例：上传成功解析 url/object_key/size；413 抛错含状态码；400 抛错含文案

## 2. CLI 命令

- [x] 2.1 `src/commands.ts` 新增 `image upload <file>` 命令：文件存在性/扩展名（png/jpg/jpeg/webp）/大小（≤5MB）前置校验，成功输出 `URL:` 与 `Markdown:` 两行
- [x] 2.2 `src/commands.test.ts` 新增用例：gif 拒绝、超 5MB 拒绝（均不发请求，退出码非 0）

## 3. MCP 工具

- [x] 3.1 `src/mcp.ts` 新增 `docz_upload_image` 工具定义（入参 `file_path`）与 handler（校验同 CLI，成功 `ok()` 含 URL + Markdown 引用，失败 `fail()`）
- [x] 3.2 MCP 测试：文件不存在返回 fail；合法 png 上传成功返回含 `![name](url)` 的消息

## 4. 文档与发布

- [x] 4.1 更新 `README.md`：Commands 表、MCP Tools 表、API Reference 表、Usage Examples 补 `image upload` 示例
- [x] 4.2 更新 `skills/SKILL.md`：命令清单与配图使用指引（先 `image upload` 拿 URL，再写 `![alt](url)`；公网可见、不占配额）
- [x] 4.3 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过
- [x] 4.4 `pnpm changeset` 添加 minor 变更说明
