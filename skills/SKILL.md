---
name: docsync
description: 读写公司 DocSync 文档。触发："查看文档"、"上传文档"、"读取 Space"、"docz"、"DocSync"
version: 0.3.0
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "<command> <space>:<path>"
---

# DocSync — 读写公司文档

读写 DocSync（docz.zhenguanyu.com）平台上的文档。

## 使用方式选择

**优先使用 MCP 工具**（`mcp__docsync__*`）。MCP 工具自带认证，无需额外配置。

如果 MCP 工具不可用（未配置 docsync MCP server），回退到 CLI 方式。

### 检查 MCP 是否可用

直接调用 `mcp__docsync__docsync_list_spaces`。如果工具存在且返回结果，使用 MCP 方式。如果工具不存在，使用 CLI 方式。

## 方式一：MCP 工具（推荐）

### 工具列表

| 工具 | 用途 |
|------|------|
| `docsync_list_spaces` | 列出所有可访问的 Space |
| `docsync_list_files` | 列出目录内容。参数：`space`（名称或 ID）, `path`（可选） |
| `docsync_read_file` | 读取文件内容。参数：`space`, `path` |
| `docsync_upload_file` | 上传文件。参数：`space`, `path`（目录）, `filename`, `content` |
| `docsync_mkdir` | 创建文件夹。参数：`space`, `path` |
| `docsync_delete` | 删除文件/文件夹。参数：`space`, `path` |
| `docsync_file_history` | 查看变更历史。参数：`space`, `path`（可选） |

### 使用示例

**浏览文档**：
1. `docsync_list_spaces` → 列出所有 Space
2. `docsync_list_files(space="研发")` → 列出根目录
3. `docsync_list_files(space="研发", path="docs")` → 列出子目录
4. `docsync_read_file(space="研发", path="docs/guide.md")` → 读取文件

**上传文档**：
1. `docsync_upload_file(space="吴鹏飞", path="reports", filename="summary.md", content="# 报告内容...")` → 上传

**查看历史**：
1. `docsync_file_history(space="研发", path="docs/guide.md")` → 文件变更记录

### MCP 方式下的搜索/处理

MCP 工具返回的是文本内容，Agent 可以直接在内存中搜索、分析、转换，然后用 `docsync_upload_file` 写回。等价于 CLI 管道操作，但不需要 Bash。

例如用户说"帮我在研发 Space 里找包含'部署'的文档"：
1. `docsync_list_files(space="研发")` 获取文件列表
2. 逐个 `docsync_read_file` 读取
3. 在内容中查找"部署"关键词
4. 返回匹配结果

## 方式二：CLI 工具（备选）

需要环境中有 `DOCSYNC_API_TOKEN` 环境变量或已执行 `docz-cli login`。

### 安装

```bash
npm install -g docz-cli    # 全局安装
# 或
npx docz-cli <command>     # 免安装
```

### Token 配置

```bash
# 如果 DOCSYNC_API_TOKEN 环境变量已设置，直接可用
# 否则：
docz-cli login --token <token>
```

Token 获取：https://docz.zhenguanyu.com/settings → Account → API Tokens → New Token

### 命令速查

```bash
# 浏览
docz-cli spaces                        # 列出所有 Space
docz-cli ls <space>[:<path>]           # 列出目录内容
docz-cli cat <space>:<path>            # 读取文件内容

# 写入
docz-cli write <space>:<path> '<content>'   # 写内容到文件
docz-cli write <space>:<path> -             # 从 stdin 写入
docz-cli upload <local-file> <space>[:<dir>]
docz-cli mkdir <space>:<path>

# 管理
docz-cli mv <space>:<from> <to>
docz-cli rm <space>:<path>
docz-cli log <space>[:<path>]
docz-cli trash <space>
```

### 管道操作（CLI 独有优势）

```bash
docz-cli cat 研发:docs/guide.md | grep "部署"
docz-cli cat 研发:data.csv | cut -d',' -f1,3 | head -10
docz-cli cat 吴鹏飞:config.md | sed 's/old/new/g' | docz-cli write 吴鹏飞:config.md -
```

## 寻址格式（MCP 和 CLI 通用）

- Space 支持名称（`研发`）或 ID（`c4d903fe-...`）
- CLI 格式：`<space>:<path>`（如 `研发:docs/guide.md`）
- MCP 格式：`space="研发", path="docs/guide.md"`

## 注意事项

- DocSync 底层基于 Git，每次写操作自动产生 commit
- 删除不是永久的，30 天内可从回收站恢复
- 文本文件（.md / .csv / .html）可直接读取，二进制文件建议上传而非读取
