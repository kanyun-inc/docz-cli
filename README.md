# docz-cli

DocSync 命令行工具 — 在终端读写公司文档。

## 安装

```bash
pnpm install && pnpm build
```

全局使用：

```bash
npm link
# 或直接
alias docz="node /path/to/docz-cli/dist/index.js"
```

## 配置

两种方式任选：

```bash
# 方式一：环境变量
export DOCSYNC_API_TOKEN=<your-token>

# 方式二：login 命令（保存到 ~/.docz/config.json）
docz login --token <your-token>
```

Token 获取：登录 https://docz.zhenguanyu.com → 进入任意 Space → 页面内创建 API Token。

## 使用

所有命令的寻址格式统一为 `<space>:<path>`，Space 支持名称或 ID。

### 浏览

```bash
docz spaces                    # 列出所有 Space
docz ls 研发                    # 列出根目录
docz ls 研发:docs               # 列出子目录
docz cat 研发:docs/guide.md     # 读取文件内容
```

### 写入

```bash
# 直接写内容
docz write 吴鹏飞:notes/todo.md '# TODO List'

# 从 stdin 写入
echo '# Generated Report' | docz write 吴鹏飞:reports/daily.md -

# 上传本地文件
docz upload ./report.pdf 研发:reports

# 创建文件夹
docz mkdir 研发:new-project
```

### 管理

```bash
docz mv 研发:old-name.md new-name.md    # 重命名/移动
docz rm 研发:deprecated.md               # 删除（30 天内可从回收站恢复）
docz log 研发                             # Space 操作历史
docz log 研发:docs/guide.md              # 单文件变更历史
docz trash 研发                           # 查看回收站
```

### 其他

```bash
docz whoami      # 当前登录用户
docz --help      # 完整帮助
docz ls --help   # 单命令帮助
```

## 在 AI Agent 中使用

docz-cli 设计为终端原生工具，任何能执行 shell 命令的 AI Agent 都能直接调用：

```
用户：帮我看看研发 Space 里有什么文档
Agent：执行 docz ls 研发
Agent：研发 Space 下有 3 个文件...

用户：把这份分析报告上传到我的 Space
Agent：执行 docz write 吴鹏飞:reports/analysis.md '<内容>'
Agent：已上传到 reports/analysis.md
```

环境变量 `DOCSYNC_API_TOKEN` 配置好后，Agent 的 Bash 工具可以直接使用所有命令。

## DocSync API

docz-cli 封装了以下 DocSync REST API：

| 命令 | API |
|------|-----|
| `spaces` | `GET /api/spaces` |
| `ls` | `GET /api/spaces/{id}/tree?path=` |
| `cat` | `GET /api/spaces/{id}/blob/{path}` |
| `upload` / `write` | `POST /api/spaces/{id}/files/upload` (FormData) |
| `mkdir` | `POST /api/spaces/{id}/files/mkdir` |
| `rm` | `POST /api/spaces/{id}/files/delete` |
| `mv` | `POST /api/spaces/{id}/files/rename` |
| `log` | `GET /api/spaces/{id}/log/[{path}]` |
| `trash` | `GET /api/spaces/{id}/trash` |

认证统一使用 `Authorization: Bearer <token>`。DocSync 底层基于 Git，所有写操作自动产生 commit，天然有版本历史。
