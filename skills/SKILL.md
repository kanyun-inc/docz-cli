---
name: docsync
description: 读写公司 DocSync 文档。触发："查看文档"、"上传文档"、"读取 Space"、"docz"、"DocSync"
version: 0.3.1
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "<command> <space>:<path>"
allowed-tools: Bash(npx docz-cli:*), Bash(docz-cli:*), Bash(export DOCSYNC_API_TOKEN:*)
---

# DocSync — 读写公司文档

通过 `docz-cli` 命令行工具读写 DocSync（docz.zhenguanyu.com）平台上的文档。

## 认证检查

执行任何操作前，先检查 token 是否可用：

```bash
npx docz-cli whoami
```

- **成功**：显示用户名，直接执行后续操作
- **失败**（`No token configured`）：检查 `DOCSYNC_API_TOKEN` 环境变量是否存在。如果不存在，请用户提供 DocSync API Token（获取方式：https://docz.zhenguanyu.com/settings → Account → API Tokens → New Token），然后：

```bash
export DOCSYNC_API_TOKEN=<用户提供的 token>
```

之后所有 `npx docz-cli` 命令自动使用该 token。

## 命令速查

```bash
# 浏览
npx docz-cli spaces                        # 列出所有 Space
npx docz-cli ls <space>[:<path>]           # 列出目录内容
npx docz-cli cat <space>:<path>            # 读取文件内容

# 写入
npx docz-cli write <space>:<path> '<content>'   # 写内容到文件
npx docz-cli write <space>:<path> -             # 从 stdin 写入
npx docz-cli upload <local-file> <space>[:<dir>]
npx docz-cli mkdir <space>:<path>

# 管理
npx docz-cli mv <space>:<from> <to>
npx docz-cli rm <space>:<path>
npx docz-cli log <space>[:<path>]
npx docz-cli trash <space>
```

## 寻址格式

`<space>:<path>` — Space 支持名称（`研发`）或 ID（`c4d903fe-...`）

- `研发` — 根目录
- `研发:docs` — 子目录
- `研发:docs/guide.md` — 具体文件

## 管道操作

`cat` 输出到 stdout，`write ... -` 从 stdin 读取：

```bash
npx docz-cli cat 研发:docs/guide.md | grep "部署"
npx docz-cli cat 研发:data.csv | cut -d',' -f1,3 | head -10
npx docz-cli cat 吴鹏飞:config.md | sed 's/old/new/g' | npx docz-cli write 吴鹏飞:config.md -
```

## 使用场景

### 查看文档

```bash
npx docz-cli spaces
npx docz-cli ls 研发
npx docz-cli cat 研发:docs/guide.md
```

### 上传/保存内容

```bash
npx docz-cli write 吴鹏飞:reports/summary.md '# 周报摘要
- 完成了 XXX
- 修复了 YYY'

npx docz-cli upload ./analysis.csv 吴鹏飞:data
```

### 查看历史

```bash
npx docz-cli log 研发
npx docz-cli log 研发:docs/guide.md
```

### 整理文档

```bash
npx docz-cli mkdir 吴鹏飞:archive/2026-Q1
npx docz-cli mv 吴鹏飞:old-report.md archive/2026-Q1/old-report.md
npx docz-cli rm 吴鹏飞:temp/draft.md
```

## 注意事项

- DocSync 底层基于 Git，每次写操作自动产生 commit
- 删除进入回收站，30 天内可恢复
- 文本文件（.md / .csv / .html）可直接读取
- 二进制文件建议用 upload，不适合 cat
