---
name: docz
description: Read and write company DocSync documents. Triggers on "docs", "documents", "upload file", "read space", "docz", "DocSync", "share link", "diff"
version: 0.7.0
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "spaces | ls <space> | cat <space>:<path> | shortlink <space>:<path> | share list <space> | diff <space>:<path> <commit>"
allowed-tools: Bash(*)
---

# DocSync — Read & Write Company Documents

CLI tool `docz-cli` for reading and writing files in DocSync (docz.zhenguanyu.com). Outputs to stdout, reads from stdin — designed to compose with Unix pipes.

## Auth Check

Before first use:

```bash
echo $DOCSYNC_API_TOKEN
```

- **Non-empty**: proceed
- **Empty**: tell the user to create a token at https://docz.zhenguanyu.com/settings → Account → API Tokens → New Token, then configure it in Rush user environment variable settings

## Addressing

All commands use `<space>:<path>`. The `<space>` segment accepts a space name or UUID. When ambiguous, use `npx docz-cli@latest spaces` to verify, then use UUID.

```
研发                    → root of space "研发"
研发:docs               → subdirectory
研发:docs/guide.md      → specific file
```

### Short URL Support

`cat`, `ls`, `log` also accept DocSync short URLs directly:

```bash
npx docz-cli@latest cat https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
npx docz-cli@latest ls https://docz.zhenguanyu.com/s/yanfa
npx docz-cli@latest log https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
```

## Commands

```bash
npx docz-cli@latest spaces                                # list all spaces
npx docz-cli@latest ls <space>[:<path>]                   # list directory
npx docz-cli@latest cat <space>:<path>                    # read file to stdout
npx docz-cli@latest write <space>:<path> '<text>'         # write content to file
npx docz-cli@latest write <space>:<path> -                # write from stdin
npx docz-cli@latest upload <local-file> <space>[:<dir>]   # upload file
npx docz-cli@latest mkdir <space>:<path>                  # create folder
npx docz-cli@latest mv <space>:<from> <to>                # rename/move
npx docz-cli@latest rm <space>:<path>                     # delete (30-day trash)
npx docz-cli@latest log <space>[:<path>]                   # change history
npx docz-cli@latest shortlink <space>:<path>              # get short URL
npx docz-cli@latest trash <space>                         # view deleted files
npx docz-cli@latest diff <space>[:<path>] <commit> [<from>]  # view changes
```

### Share Links

```bash
npx docz-cli@latest share create <space>:<path> [--expires 7d] [--users user@co.com]
npx docz-cli@latest share list <space> [--file <path>]
npx docz-cli@latest share update <space> <link-id> [--expires 30d]
npx docz-cli@latest share cat <token-or-url> [--raw]
npx docz-cli@latest share info <token-or-url>
npx docz-cli@latest share rm <space> <link-id>
```

## Diff

View what changed in a commit or compare two commits:

```bash
# File-level diff
npx docz-cli@latest diff 研发:docs/guide.md af0fb9b

# Compare two commits
npx docz-cli@latest diff 研发:docs/guide.md af0fb9b b2c3d4e

# Space-level: which files changed
npx docz-cli@latest diff 研发 af0fb9b

# Typical workflow: log → pick commit → diff
npx docz-cli@latest log 研发:docs/guide.md
npx docz-cli@latest diff 研发:docs/guide.md af0fb9b
```

## Unix Pipes

`cat` writes to stdout. `write ... -` reads from stdin. Combine freely with standard Unix tools.

**Search content:**
```bash
npx docz-cli@latest cat 研发:docs/guide.md | grep -i "deploy"
npx docz-cli@latest cat 研发:docs/guide.md | grep -n "TODO"
```

**Extract and transform:**
```bash
npx docz-cli@latest cat 研发:data.csv | cut -d',' -f1,3 | head -20
npx docz-cli@latest cat 研发:data.csv | awk -F',' '$3 > 1000 {print $1, $3}'
npx docz-cli@latest cat 研发:report.md | wc -l
```

**Read → process → write back:**
```bash
npx docz-cli@latest cat 吴鹏飞:config.md | sed 's/old-value/new-value/g' | npx docz-cli@latest write 吴鹏飞:config.md -
```

**Generate and upload:**
```bash
echo "# Auto-generated at $(date)" | npx docz-cli@latest write 吴鹏飞:notes/auto.md -
cat local-file.md | npx docz-cli@latest write 吴鹏飞:docs/remote.md -
```

**Combine multiple files:**
```bash
for f in intro.md body.md conclusion.md; do
  npx docz-cli@latest cat 研发:chapters/$f
done | npx docz-cli@latest write 研发:full-report.md -
```

## Tips

- Use `npx docz-cli@latest` to always run the latest version.
- Prefer pipes over multiple round-trips. `cat | grep` is one operation, not two.
- `cat` returns raw text — pipe to `head`, `tail`, `grep`, `awk`, `sed`, `wc`, `sort`, `uniq` as needed.
- For CSV data, use `cut`, `awk`, and `sort`.
- `write <path> -` accepts any stdin — command output, heredocs, pipe chains.
- `write` overwrites the entire file (not append). To append, `cat` first, combine, then `write` back.
- `rm` moves to trash (recoverable for 30 days), not permanent delete.
- `mv` renames/moves within the same space.
- Backend is Git: every write creates a commit. Use `log` to see history, `diff` to see changes.
- After writing a file, use `shortlink` to get a clickable URL for the user.
- Text files (.md, .csv, .html) work with `cat`. Binary files (images, PDF) use `upload` only.
- Short URLs (`/s/slug/f/fileId`) can be pasted directly into `cat`, `ls`, `log`.
- Share links let you share files with specific users or publicly, with optional expiry.
