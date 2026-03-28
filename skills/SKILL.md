---
name: docz
description: Read and write company DocSync documents. Triggers on "docs", "documents", "upload file", "read space", "docz", "DocSync"
version: 0.5.0
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "spaces | ls <space> | cat <space>:<path>"
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

All commands use `<space>:<path>`. The `<space>` segment accepts a space name or UUID. When ambiguous, use `npx docz-cli spaces` to verify, then use UUID.

```
研发                    → root of space "研发"
研发:docs               → subdirectory
研发:docs/guide.md      → specific file
```

## Commands

```bash
npx docz-cli spaces                           # list all spaces
npx docz-cli ls <space>[:<path>]              # list directory
npx docz-cli cat <space>:<path>               # read file to stdout
npx docz-cli write <space>:<path> '<text>'    # write content to file
npx docz-cli write <space>:<path> -           # write from stdin
npx docz-cli upload <local-file> <space>[:<dir>]
npx docz-cli mkdir <space>:<path>
npx docz-cli mv <space>:<from> <to>
npx docz-cli rm <space>:<path>
npx docz-cli log <space>[:<path>]             # Git commit history
npx docz-cli trash <space>
```

## Unix Pipes

`cat` writes to stdout. `write ... -` reads from stdin. Combine freely with standard Unix tools.

**Search content:**
```bash
npx docz-cli cat 研发:docs/guide.md | grep -i "deploy"
npx docz-cli cat 研发:docs/guide.md | grep -n "TODO"
```

**Extract and transform:**
```bash
npx docz-cli cat 研发:data.csv | cut -d',' -f1,3 | head -20
npx docz-cli cat 研发:data.csv | awk -F',' '$3 > 1000 {print $1, $3}'
npx docz-cli cat 研发:report.md | wc -l
```

**Read → process → write back:**
```bash
npx docz-cli cat 吴鹏飞:config.md | sed 's/old-value/new-value/g' | npx docz-cli write 吴鹏飞:config.md -
```

**Generate and upload:**
```bash
echo "# Auto-generated at $(date)" | npx docz-cli write 吴鹏飞:notes/auto.md -
cat local-file.md | npx docz-cli write 吴鹏飞:docs/remote.md -
```

**Combine multiple files:**
```bash
# Concatenate files
for f in intro.md body.md conclusion.md; do
  npx docz-cli cat 研发:chapters/$f
done | npx docz-cli write 研发:full-report.md -
```

## Tips

- Prefer pipes over multiple round-trips. `cat | grep` is one operation, not two.
- `cat` returns raw text — pipe to `head`, `tail`, `grep`, `awk`, `sed`, `wc`, `sort`, `uniq` as needed.
- For CSV data, use `cut`, `awk`, and `sort`.
- `write <path> -` accepts any stdin — command output, heredocs, pipe chains.
- `write` overwrites the entire file (not append). To append, `cat` first, combine, then `write` back.
- `rm` moves to trash (recoverable for 30 days), not permanent delete.
- `mv` renames/moves within the same space.
- Backend is Git: every write creates a commit. Use `log` to see history.
- Text files (.md, .csv, .html) work with `cat`. Binary files (images, PDF) use `upload` only.
