# Proposal: Docz CLI 链接元信息查询

> 关联 Claroflow task：[2363] Docz CLI 支持普通链接和分享链接元信息查询

## Why

终端用户和 AI agent 收到 Docz 链接后，目前只能尝试读取内容来判断链接是否可用，无法稳定区分链接失效、空间无权限、文档删除和网络异常。普通链接与分享链接又采用不同权限模型，需要提供独立、可脚本化的元信息查询入口。

## What Changes

- 新增 `docz link info <url>`，查询普通链接的链接状态、当前用户空间权限、文档路径、文档状态、Space 管理员及目录类型
- 扩展现有 `docz share info <token-or-url>`，按分享语义输出链接生命周期、当前访问状态、分享范围、目标文档状态、分享角色、分享人、过期时间、目录类型及 Space 权限
- 两个命令均支持 `--json`，各自拥有独立 JSON 契约，不强制字段对齐
- 服务端补充路径型普通链接诊断和分享链接诊断所需元数据，同时保持内容读取权限不变
- 所有网络结果按成功、确定失败、未知三态处理；超时、5xx、连接中断或非法响应不得误判为链接/文档不存在
- 更新 CLI 文档、skill 文档、changeset，并增加服务端、CLI 自动化测试与 test-uts 真机验证

## Capabilities

### New Capabilities

- `normal-link-metadata`: 通过独立 CLI 命令诊断普通短链接、路径链接、Space 根链接和 legacy 链接
- `share-link-metadata`: 通过分享专用 CLI 命令诊断分享链接生命周期、访问状态及目标元信息

### Modified Capabilities

（无）

## Impact

- CLI 仓库：`src/client.ts`、`src/commands.ts`、相关测试、`README.md`、`skills/SKILL.md`
- 服务端仓库：file-ref/path diagnostic、share info/diagnostic handler 及相关测试
- API：复用 `GET /api/file-refs/:id/diagnostic`；新增路径诊断能力并扩展分享 info 响应
- 鉴权：普通链接要求 API Token；公开分享可匿名查询，受限分享遵循现有 OptionalAuth 与目标用户/组权限
- 兼容性：现有 `share info` 文本字段保留并追加信息；新增 `--json` 作为稳定机器契约
- 发布与部署：CLI 增加 changeset；服务端部署 test-uts 后使用本地构建 CLI 做真实环境验证

## Reference

- Epic 未挂 `doczLinks`，无 PRD 落盘
- 方案选择：两个独立 CLI 入口、两套输出模型；普通链接与分享链接分别走服务端诊断链路
