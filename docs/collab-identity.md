# 协同文件身份修复与验证

## 问题与证据边界

旧 CLI 只使用 `<spaceId>:<path>` 房间。参考服务端基线 `8a4aa9fad70fe4a60353271694cbd085ec3d7adb` 中，已加入身份会话的文件会拒绝旧路径房间，并返回 HTTP 409 / `reload_for_file_identity`。但 `HttpDoczClient.authorize` 将非 2xx 抛为普通 Error，Hocuspocus 默认把缺少 reason 的异常发为 `permission-denied`。

这是源码已证实的协议不兼容路径。2026-09-23 事件只有 authorize=409 与客户端 permission-denied 的对应时间证据，没有该次 409 的响应正文，不能将具体错误码宣称为已证实的生产响应。

## 本地实现

- 每次 collab cat/write/publish/bridge open 先解析目标，再 POST `/api/collab/session`。普通文件短链接携带 file_id，目录短链接的子路径仅携带解析后的 path，避免误用父目录身份。
- enabled=true 时校验 file_id、file_path、identity_version、read_only，使用 `v2:<spaceId>:<fileId>` 房间及服务器规范路径。文件改名不改变房间，file_identity 广播及发布 ack 更新规范路径；不同空间/文件的身份广播终止连接。
- enabled=false 保留路径房间。当前服务端只为 Markdown 启用身份会话，其他支持的文本类型继续使用旧房间。Univer sheet、图形描述文件和非文本类型明确拒绝。当前文本扩展名范围见 session.ts。
- 旧部署仅在返回 Go 缺路由标准响应（404 + `404 page not found`）时兼容路径房间；文档级 file_unavailable、权限错误、409、服务错误、网络超时、无效 JSON 均不降级。未识别的旧网关缺路由页面会明确失败，需要服务端明确能力响应；不能把任何 404 都当成旧服务。
- 保留 Y.Text 和 collab_hash 检查，读取实时内容而不是 Git 快照。收到其他客户端更新后，旧 hash 写入会在本地变更前被拒绝；同时在途的 Yjs 插入仍参与 CRDT 合并。hash 不是服务端的全局 CAS，读回依然必要。
- session 只读和 Hocuspocus readonly scope 都会限制本地 write/publish；服务器仍执行实际权限校验。删除后不自动重建文件。
- 请求设置超时，错误输出仅包含 HTTP 状态、固定文案与允许的协议错误码。未经识别的正文、异常、认证 reason 不原样输出。裸 permission-denied 明确说明服务端未区分权限、身份或服务故障。
- 初始连接失败是普通失败；publish 发出后断连、超时、非法 ack、显式 unknown、旧版无 outcome 的非确定性错误均是 UNKNOWN / exit 75。明确 failure 保留固定错误码；HTTP 5xx 发布错误保守视为 UNKNOWN。旧版确定的 forbidden/read_only/external_deleted/content_too_large 可识别为拒绝。
- 不自动重试或重连；未知发布会冻结当前连接，必须显式重新打开、读回、合并后再决定操作。publish 带 operationId=reqId，但本次不实现自动重放或自动 status 恢复。--no-publish 等待 Yjs 更新确认，超时或断连同样返回 75。
- 短命令在成功和失败时均清理连接。bridge 保留原 error 字段，并对协同协议错误补充 code/outcome；失败 open 自行清理连接。

## 最小服务端配套改动（本次未修改、未部署）

CLI 无法还原服务器已经丢掉的 HTTP 错误细节。要从根源区分 WebSocket 认证失败，最小改动位于 collab-server 的 `HttpDoczClient.authorize` 和 `onAuthenticate`：

1. 将后端明确 401/403 转成固定授权拒绝 reason，不把响应正文或 token 放入 reason。
2. 非 2xx 的 409 解析受限的 JSON code，只透传协议白名单中的 reload_for_file_identity、legacy_room_active、identity_unavailable、capability_disabled 等；其他 409 给固定身份冲突类别。
3. 网络/5xx 使用固定 service_unavailable 或 session_unavailable reason；给 authorize HTTP 请求增加有界超时。
4. 抛出带 `reason` 的受控异常，使 Hocuspocus 保留原因。不能通过取消 enrollment 检查、回退权限或重开旧路径房间来“修复”。
5. 添加 authorize HTTP→WebSocket reason 契约测试，使用假 token 断言日志和客户端错误没有凭据。

另有配套建议：旧路径 flush 的 HTTP 5xx 也应分类 unknown，避免将“服务端可能提交但响应失败”标记为明确 failure。CLI 本次已经对此保守处理。新身份操作的 outcome 必须保留。

## 验证与 review 状态

使用本地 Hocuspocus 2.15.3 + 真实 WebSocket + 合成 Y.Doc 运行测试，未对生产文档实施故障、删除、改名、并发破坏或假凭据测试。session 使用受控 HTTP mock，CLI 测试通过完整命令解析和真实房间验证退出语义。

覆盖 session enabled/disabled、旧缺路由、结构错误、401/403/409/503、请求超时、稳定身份连接、旧文本房间、只读、迁移拒绝、改名广播、删除、并发 hash 冲突与在途 Yjs 更新、发布明确失败/未知/超时/断连、非法 ack、关闭与失败连接清理、日志脱敏。

最终执行 `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部成功；测试 302 通过、1 个既有可选集成测试跳过，其中协同相关 63 通过。`git diff --check` 通过。

本次完成作者自查和自动测试，未做独立 code review。npm 发布、合并和生产部署均未执行。服务端参考仓库只读，未覆盖其已有修改。

## 已授权方案保存

使用构建后的本地 CLI 对用户指定原文档执行 collab cat → 三方比较 → collab write（指定最新 base-collab-hash）→ collab cat 回读。远端最新内容与生成方案时的基线逐字节一致，因此合并结果为已授权完整稿，没有覆盖其他人的新增编辑。

服务端确认发布，回读与 48,677 字节合并稿逐字节一致。方案继续保持“待评审、尚未实施、未做独立 review”状态；白名单内自动重建、复用当前隔离流程、原路径继续同步、既有去重及 30 天策略均保留。业务正文和带凭据日志未写入仓库。
