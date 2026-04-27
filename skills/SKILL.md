---
name: docz
description: Read and write company DocSync documents. Triggers on "docs", "documents", "upload file", "read space", "docz", "DocSync", "save file", "rollback", "comment", "share link", "diff"
version: 0.8.0
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "spaces | ls <space> | cat <space>:<path> | write <space>:<path> '<text>' | comment list <space>:<path> | shortlink <space>:<path> | diff <space>:<path> <commit>"
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

Most commands accept DocSync short URLs (`/s/{slug}/f/{fileId}` or `/s/{slug}`) directly as target:

```bash
npx docz-cli@latest cat https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
npx docz-cli@latest ls https://docz.zhenguanyu.com/s/yanfa
npx docz-cli@latest log https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
npx docz-cli@latest write https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c 'new content'
npx docz-cli@latest rm https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
npx docz-cli@latest diff https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c abc1234
```

## Commands

### Basic Operations

```bash
npx docz-cli@latest spaces                                # list all spaces
npx docz-cli@latest whoami                                 # current user info
npx docz-cli@latest ls <space>[:<path>]                   # list directory
npx docz-cli@latest ls -R <space>                         # list all files recursively
npx docz-cli@latest cat <space>:<path>                    # read file to stdout
npx docz-cli@latest cat --ref <space>:<path>              # read file + print ref to stderr
npx docz-cli@latest upload <local-file> <space>[:<dir>]   # upload file
npx docz-cli@latest mkdir <space>:<path>                  # create folder
npx docz-cli@latest mv <space>:<from> <to>                # rename/move
npx docz-cli@latest rm <space>:<path>                     # delete (30-day trash)
npx docz-cli@latest log <space>[:<path>]                  # change history
npx docz-cli@latest diff <space>[:<path>] <commit> [<from>]  # view changes
npx docz-cli@latest shortlink <space>:<path>              # get short URL
```

### Safe Write (with conflict detection)

```bash
npx docz-cli@latest write <space>:<path> '<text>'         # write content (auto conflict detection)
npx docz-cli@latest write <space>:<path> -                # write from stdin
npx docz-cli@latest write --force <space>:<path> '<text>' # skip conflict detection
```

`write` automatically reads the current file version (ref) before saving. If the file was modified by someone else between read and write, a **409 Conflict** error is returned:
```
Error: file was modified by someone else. Please re-read the latest content and try again.
```
In this case, re-read the file with `cat`, re-apply changes, and `write` again. Content limit: **2MB** (use `upload` for larger files).

### Version Management

```bash
npx docz-cli@latest log <space>:<path>                    # show commit history
npx docz-cli@latest rollback <space>:<path> <commit>      # rollback file to a specific commit
npx docz-cli@latest trash <space>                         # list deleted files (30-day retention)
npx docz-cli@latest restore <space>:<path> <commit>       # restore deleted file
```

### Comments

```bash
npx docz-cli@latest comment list <space>:<path>           # list comments on a file
npx docz-cli@latest comment add <space>:<path> '<msg>'    # add comment
npx docz-cli@latest comment reply <space> <id> '<msg>'    # reply to comment
npx docz-cli@latest comment close <space> <id>            # close comment
npx docz-cli@latest comment rm <space> <id>               # delete comment
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

### Diff

View what changed in a commit or compare two commits:

```bash
npx docz-cli@latest diff 研发:docs/guide.md af0fb9b          # file-level diff
npx docz-cli@latest diff 研发:docs/guide.md af0fb9b b2c3d4e  # compare two commits
npx docz-cli@latest diff 研发 af0fb9b                         # space-level: which files changed
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
- `write` has a 2MB limit. For larger files, use `upload`.
- `write` detects concurrent edits automatically. If conflict occurs, re-read and retry.
- `rm` moves to trash (recoverable for 30 days), not permanent delete. Use `trash` + `restore` to recover.
- `rollback` reverts a file to a specific historical version (creates a new commit).
- Backend is Git: every write creates a commit. Use `log` to see history, `diff` to see changes.
- After writing a file, use `shortlink` to get a clickable URL for the user.
- Text files (.md, .csv, .html) work with `cat`. Binary files (images, PDF) use `upload` only.
- Short URLs (`/s/slug/f/fileId`) can be pasted directly into most commands (`cat`, `ls`, `log`, `write`, `rm`, `mv`, `diff`, `upload`, `rollback`, `restore`, `mkdir`, `comment list/add`, `share create`, `shortlink`). Space-only commands (`trash`, `comment reply/close/rm`, `share list/update/rm`) still require space name.
- Share links let you share files with specific users or publicly, with optional expiry.
