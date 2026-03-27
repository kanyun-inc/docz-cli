---
name: docsync
description: 读写公司 DocSync 文档。触发："查看文档"、"上传文档"、"读取 Space"、"docz"、"DocSync"
version: 0.2.1
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "<command> <space>:<path>"
allowed-tools: Bash(docz-cli:*), Bash(npx docz-cli:*)
---

# DocSync — 读写公司文档

通过 `docz-cli` 命令行工具读写 DocSync 平台上的文档。

## 前置条件

- Node.js >= 22
- 环境变量 `DOCSYNC_API_TOKEN` 已配置，或已执行 `docz-cli login --token <token>`

Token 获取：https://docz.zhenguanyu.com/settings → Account → API Tokens → New Token

## 寻址格式

所有命令统一使用 `<space>:<path>` 格式：

- `研发` — 研发 Space 根目录
- `研发:docs` — 研发 Space 的 docs 目录
- `研发:docs/guide.md` — 具体文件
- Space 支持名称（`研发`）或 ID（`c4d903fe-...`）

## 命令速查

```bash
# 浏览
docz-cli spaces                        # 列出所有 Space
docz-cli ls <space>[:<path>]           # 列出目录内容
docz-cli cat <space>:<path>            # 读取文件内容

# 写入
docz-cli write <space>:<dir/file> '<content>'   # 写内容到文件
docz-cli write <space>:<dir/file> -             # 从 stdin 写入
docz-cli upload <local-file> <space>[:<dir>]    # 上传本地文件
docz-cli mkdir <space>:<path>                    # 创建文件夹

# 管理
docz-cli mv <space>:<from> <to>        # 重命名/移动
docz-cli rm <space>:<path>             # 删除（30 天内可恢复）
docz-cli log <space>[:<path>]          # 查看变更历史
docz-cli trash <space>                 # 查看回收站
```

## 管道操作

`cat` 输出到 stdout，`write ... -` 从 stdin 读取，可与任意 Unix 工具组合：

```bash
# 搜索内容
docz-cli cat 研发:docs/guide.md | grep "部署"

# CSV 列提取
docz-cli cat 研发:data.csv | cut -d',' -f1,3 | head -10

# 读取 → 替换 → 写回
docz-cli cat 吴鹏飞:config.md | sed 's/old/new/g' | docz-cli write 吴鹏飞:config.md -

# 本地命令输出 → 写到 DocSync
echo "# Generated" | docz-cli write 吴鹏飞:notes/auto.md -
cat local-file.md | docz-cli write 吴鹏飞:docs/remote.md -
```

## 使用场景

### 场景 1：用户想查看某个 Space 的文档

```bash
# 先列出 Space
docz-cli spaces

# 浏览目录
docz-cli ls 研发
docz-cli ls 研发:docs

# 读取文件
docz-cli cat 研发:docs/guide.md
```

### 场景 2：用户想上传/保存内容到 DocSync

```bash
# 直接写入内容
docz-cli write 吴鹏飞:reports/summary.md '# 周报摘要

## 本周完成
- 完成了 XXX 功能
- 修复了 YYY bug'

# 上传本地文件
docz-cli upload ./analysis.csv 吴鹏飞:data

# 管道写入（适合长内容）
echo "$CONTENT" | docz-cli write 吴鹏飞:notes/memo.md -
```

### 场景 3：用户想查看文件历史

```bash
# Space 级别的操作日志
docz-cli log 研发

# 单文件变更历史
docz-cli log 研发:docs/guide.md
```

### 场景 4：用户想整理文档

```bash
# 创建目录
docz-cli mkdir 吴鹏飞:archive/2026-Q1

# 移动文件
docz-cli mv 吴鹏飞:old-report.md archive/2026-Q1/old-report.md

# 删除（进入回收站，30 天内可恢复）
docz-cli rm 吴鹏飞:temp/draft.md

# 查看回收站
docz-cli trash 吴鹏飞
```

## 注意事项

- DocSync 底层基于 Git，每次写操作自动产生 commit
- 删除不是永久的，30 天内可从回收站恢复
- `docz-cli cat` 输出原始文件内容，适合文本文件（.md / .csv / .html）
- 二进制文件（图片、PDF）建议用 `docz-cli upload` 上传，不适合用 `cat` 读取
- 如果 `docz-cli` 未安装，可以用 `npx docz-cli` 替代
