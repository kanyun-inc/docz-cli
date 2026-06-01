---
name: docz
description: Read and write company DocSync documents. Triggers on "docs", "documents", "upload file", "read space", "docz", "DocSync", "save file", "rollback", "restore", "trash", "version history", "comment", "share link", "diff"
version: 0.12.0
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "spaces | whoami | ls/cat/write/upload/mkdir/mv/rm/log/rollback/trash/restore/shortlink/diff | comment <subcmd> | share <subcmd>"
allowed-tools: Bash(*)
---

# DocSync — Read & Write Company Documents

CLI tool `docz-cli` for reading and writing files in DocSync (docz.zhenguanyu.com). Outputs to stdout, reads from stdin — designed to compose with Unix pipes.

## Auth Check

Before first use, verify auth with:

```bash
npx docz-cli@latest whoami
```

- **Success**: proceed
- **Failure**: tell the user to create a token at https://docz.zhenguanyu.com/settings → Account → API Tokens → New Token, then configure it:

```bash
npx docz-cli@latest login --token <your-token>
# or
export DOCSYNC_API_TOKEN=<your-token>
```

## Addressing

All commands use `<space>:<path>`. The `<space>` segment accepts a space name, slug, or UUID.

**Space name resolution priority**: exact name > slug > suffix match (e.g. "研发" matches "G160-研发"). If suffix matches multiple spaces, CLI rejects with an ambiguity error.

**Agent rule**: Prefer a full DocSync URL if the user provides one. If you need a space argument and are not certain of the exact name/slug/UUID, run `npx docz-cli@latest spaces` first. Do not invent, translate, or simplify space names. Suffix matching is only a CLI fallback, not the preferred form.

```
G160-研发                    → root of space "G160-研发"
G160-研发:docs               → subdirectory
G160-研发:docs/guide.md      → specific file
```

### URL Support

Commands that take a `<space>` or `<space>:<path>` target accept DocSync URLs directly. `share cat` and `share info` accept share URLs separately. `login`, `whoami`, and `spaces` do not take document URLs.

Supported DocSync URL formats:

- **Short URL (fileId)**: `/s/{slug}/f/{fileId}` — resolves fileId to path via API
- **Path URL**: `/s/{slug}/path/to/file.md` — file path in URL
- **Space URL**: `/s/{slug}` — space root
- **Legacy URL**: `/spaces/{spaceId}/path/to/file` — old format, still works

```bash
npx docz-cli@latest cat https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
npx docz-cli@latest cat https://docz.zhenguanyu.com/s/yanfa/docs/guide.md
npx docz-cli@latest ls https://docz.zhenguanyu.com/s/yanfa
npx docz-cli@latest write https://docz.zhenguanyu.com/s/yanfa/docs/guide.md 'new content'
npx docz-cli@latest rm https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
npx docz-cli@latest diff https://docz.zhenguanyu.com/s/yanfa/docs/guide.md abc1234
npx docz-cli@latest trash https://docz.zhenguanyu.com/s/yanfa
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

**Safe edit workflow** — always follow this sequence to avoid overwriting concurrent edits:

1. `cat <space>:<path>` — read current content
2. Apply your changes locally
3. `write <space>:<path> '<new content>'` — `write` re-fetches the file ref under the hood and rejects with **409 Conflict** if someone else has modified it in between
4. On 409: go back to step 1 (re-read latest, re-apply changes, write again)

Use `cat --ref` only if you need to display or log the Git ref; the safe-edit workflow above does not require it. Use `--force` only when you intentionally want to overwrite (e.g. fully regenerated content). Content limit: **2MB** — use `upload` for larger files.

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
npx docz-cli@latest comment add <space>:<path> '<msg>' --quote '<text>'   # selection comment (highlighted in Web UI)
# IMPORTANT: --quote must be plain text with all Markdown formatting removed.
# The Web UI highlights by searching rendered text, so Markdown syntax (**, #, [](), etc.) won't match.
# Example: if source is "**重要**的[设计文档](url)", quote should be "重要的设计文档".
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
npx docz-cli@latest diff G160-研发:docs/guide.md af0fb9b          # file-level diff
npx docz-cli@latest diff G160-研发:docs/guide.md af0fb9b b2c3d4e  # compare two commits
npx docz-cli@latest diff G160-研发 af0fb9b                         # space-level: which files changed
```

## Unix Pipes

`cat` writes to stdout. `write ... -` reads from stdin. Combine freely with standard Unix tools.

**Search content:**
```bash
npx docz-cli@latest cat G160-研发:docs/guide.md | grep -i "deploy"
npx docz-cli@latest cat G160-研发:docs/guide.md | grep -n "TODO"
```

**Extract and transform:**
```bash
npx docz-cli@latest cat G160-研发:data.csv | cut -d',' -f1,3 | head -20
npx docz-cli@latest cat G160-研发:data.csv | awk -F',' '$3 > 1000 {print $1, $3}'
npx docz-cli@latest cat G160-研发:report.md | wc -l
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
  npx docz-cli@latest cat G160-研发:chapters/$f
done | npx docz-cli@latest write G160-研发:full-report.md -
```

## Tips

- Use `npx docz-cli@latest` to always run the latest version.
- Prefer pipes over multiple round-trips. `cat | grep` is one operation, not two.
- `cat` returns raw text — pipe to `head`, `tail`, `grep`, `awk`, `sed`, `wc`, `sort`, `uniq` as needed.
- For CSV data, use `cut`, `awk`, and `sort`.
- `write` overwrites the entire file (not append). To append, `cat` first, combine, then `write` back.
- `write` has a 2MB limit. For larger files, use `upload`.
- `write` detects concurrent edits automatically. If conflict occurs, re-read and retry.
- `rm` moves to trash (recoverable for 30 days), not permanent delete. Use `trash` + `restore` to recover.
- Text files (.md, .csv, .html) work with `cat`. Binary files (images, PDF) use `upload` only.
- After writing a file, use `shortlink` to get a clickable URL for the user.
- Backend is Git: every write creates a commit. Use `log` to see history, `diff` to see changes.
- Any DocSync URL can be pasted directly into any command. Supports short URLs (`/s/slug/f/fileId`), path URLs (`/s/slug/path/to/file`), and legacy URLs (`/spaces/id/path`).
- `--quote` creates a selection comment: the quoted text is highlighted in Web UI. The quote must be **plain text** (strip all Markdown formatting like `**`, `#`, `[]()`, `` ` `` before passing). Use 10+ characters to avoid ambiguous matches.
