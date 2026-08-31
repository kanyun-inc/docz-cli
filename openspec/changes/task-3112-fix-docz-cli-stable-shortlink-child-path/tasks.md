## 1. 统一 URL 分类与 canonical 解析

- [x] 1.1 在 `src/commands.ts` 将稳定短链解析统一到 `parseNormalLink`，为 file-ref target 增加安全的 `childPath`，覆盖尾斜杠、Unicode、非法编码、traversal、编码分隔符和控制字符。
- [x] 1.2 在 `src/client.ts` 对齐 file-ref 响应中的 `slug`、`is_dir` 类型，并在 `resolveTarget` 链路校验 slug/ref Space 一致性、父目标目录类型和 canonical path 拼接。
- [x] 1.3 更新 `link info`：先诊断 fileId 父引用，只有可确认的目录才诊断 canonical child；父引用失败时保留父事实、将子事实置为 unknown/null，并保证不请求根目录 `f/...`。

## 2. 自动化回归测试

- [x] 2.1 扩展 `src/commands.test.ts` 的纯 parser 测试，覆盖稳定链接精确/尾斜杠/嵌套子路径/query/fragment 和全部安全拒绝场景。
- [x] 2.2 增加 resolver 测试，验证 canonical Space/path、Space 不一致、非目录 child、解析失败无业务 path 请求，以及普通 slug/legacy/Space 根回归。
- [x] 2.3 增加 `link info` 命令测试，覆盖 child exists/not_found 与 invalid/inaccessible/deleted/non-dir/unknown 父状态，并断言失败路径不调用 child diagnostic。
- [x] 2.4 覆盖代表性读写共享链路（cat/write/upload/mkdir/mv source），确认请求目标为 canonical child，且错误场景在 mutation 前停止。

## 3. 用户文档与发布元数据

- [x] 3.1 更新 `README.md` 和 `skills/SKILL.md` 的稳定链接说明，明确目录 child URL、`/f/` 保留路由及真实根 `f/...` 的 `space:path` 访问方式。
- [x] 3.2 添加 patch changeset，说明稳定短链子路径的安全修复与兼容性收紧。

## 4. 本地质量门禁

- [x] 4.1 运行目标测试和全量 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`，修复本变更引入的失败。
- [x] 4.2 运行 `openspec validate task-3112-fix-docz-cli-stable-shortlink-child-path --strict`，确保 proposal/spec/design/tasks 一致且有效。

## 5. test-uts 真机验收

- [x] 5.1 用本分支构建产物和 `DOCSYNC_BASE_URL=https://docz-test-uts.zhenguanyu.com` 完成只读认证/环境预检，记录 CLI 版本、服务地址和测试计划。
- [x] 5.2 创建唯一命名的隔离目录/文件，获取目录 fileId，验证 `link info`、cat/write/upload/mkdir/mv 的 canonical 子路径行为，以及文件后缀、Space 不一致和 traversal 的 mutation 前拒绝。
- [x] 5.3 删除本次隔离测试数据并复查清理完成，明确测试期间所有远端写入；不得触碰生产复现目录。

验证记录：本地构建 CLI 0.11.1 指向 `https://docz-test-uts.zhenguanyu.com`；隔离根 `codex-task-3112-20260831200115` 下的 canonical child 读写、上传、建目录和移动全部通过。文件稳定链接追加后缀、Space 不一致、traversal、无效 fileId 四类 mutation 均失败，根目录 `f/...` 未产生文件。隔离根已删除，`link info` 复查 `document_status=not_found`。

## 6. 流程收尾

- [x] 6.1 将最终 OpenSpec artifact 增量同步到 Docz 并回写 Claroflow Task 3112。
- [ ] 6.2 提交并按受控方式推送 feature 分支，将 Task 3112 流转到 `dev_done`，记录本地门禁和 test-uts 证据；不发布生产版本。
