# Tasks: Docz CLI 链接元信息查询

## 1. 服务端普通链接诊断

- [x] 1.1 在 `server/internal/handler/fileref.go` 增加 path diagnostic handler，支持 slug、space_id、根目录、active/deleted ref、repo fallback 和无权限事实
- [x] 1.2 在 `server/cmd/docsync-server/main.go` 注册 JWT/API Token 鉴权路由
- [x] 1.3 在 handler 测试中覆盖 active、deleted、missing、root、Space missing、folder 与无权限场景

## 2. 服务端分享链接元信息

- [x] 2.1 扩展 `server/internal/handler/shared_file.go` 的 share info 200 响应，增加目标存在状态和 Space owner 联系方式
- [x] 2.2 保持 401/403/404/410 的既有安全边界，并覆盖文件、目录、删除目标、公开与受限分享测试

## 3. CLI client 与状态映射

- [x] 3.1 在 `src/client.ts` 定义普通与分享两套独立诊断类型和请求方法，结构化处理普通 404 与分享 401/403/404/410
- [x] 3.2 支持分享 info 可选 Token，保证公开分享可匿名查询且不影响其它命令的登录 Gate
- [x] 3.3 在 `src/client.test.ts` 覆盖成功、确定失败、5xx/非法响应与匿名访问

## 4. CLI 命令

- [x] 4.1 在 `src/commands.ts` 增加 `link info <url> [--json]`，支持 stable/path/root/legacy URL 并拒绝分享链接
- [x] 4.2 扩展 `share info <token-or-url> [--json]`，输出分享生命周期、访问状态与分享专用字段
- [x] 4.3 未知技术状态输出 unknown 并设置退出码 2；确定业务状态正常输出
- [x] 4.4 在 `src/commands.test.ts` 增加 URL 解析、状态映射和格式化用例

## 5. 文档与发布

- [x] 5.1 更新 `README.md` 命令表与使用示例
- [x] 5.2 更新 `skills/SKILL.md`，说明两个入口及状态语义
- [x] 5.3 添加 changeset，声明新增链接元信息能力

## 6. 验证与交付

- [x] 6.1 服务端运行目标 handler 测试及相关回归测试
- [x] 6.2 CLI 运行 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [x] 6.3 部署服务端 feature worktree 到 test-uts email 模式
- [x] 6.4 使用本地构建 CLI 在 test-uts 真机验证普通文件、目录、无效链接、公开分享、受限/过期分享与目标删除
- [x] 6.5 测试后重新部署 test-uts SSO 配置并记录验证证据

## 7. 本地同步根目录与 Agent 安全策略

- [x] 7.1 新增 `local root [--json]`，仅读取客户端配置的 `sync_dir`，不连接 IPC、不鉴权、不遍历同步内容
- [x] 7.2 支持 `--client-data-dir`、`DOCSYNC_CLIENT_DATA_DIR` 和默认 `~/.docsync` 优先级
- [x] 7.3 覆盖配置缺失/损坏、相对路径、Unicode、Windows 路径及同步根目录缺失测试
- [x] 7.4 更新 Skill：本地检索必须先获得当前任务确认，且同步目录始终禁止写入
- [x] 7.5 更新写入路由：已有文本优先协同编辑，新建文本使用普通 `write`，其他变更使用对应远端 CLI

## 验证记录

- 服务端：`go test -p 1 ./... -timeout=5m` 全量通过
- CLI：typecheck、lint、143 条 Vitest 用例及 build 全部通过
- test-uts：14 个真机断言通过，覆盖 stable/path/root/legacy、文件/目录、无 Space 权限、无效链接、公开/受限/过期/无效分享以及目标删除
- 环境恢复：`/healthz` 返回 `ok`，`/api/auth/mode` 已恢复 `login_mode=sso`
- 本地根目录：聚焦单元测试、POSIX/Windows/UNC 路径用例、全量 CLI 回归及 Skill 项目结构校验通过
