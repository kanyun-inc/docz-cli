---
name: docz
description: Read, write, and collaboratively edit company DocSync documents. Triggers on "docs", "documents", "upload file", "read space", "docz", "DocSync", "save file", "rollback", "restore", "trash", "version history", "comment", "share link", "diff", "collab", "collaborative editing", "Neovim"
version: 0.15.0
author: kris
tags:
  - docsync
  - document
  - file-sync
  - knowledge
user-invocable: true
argument-hint: "spaces | whoami | ls/cat/write/upload/mkdir/mv/rm/log/rollback/trash/restore/shortlink/diff | collab cat/write/publish/bridge | comment <subcmd> | share <subcmd>"
allowed-tools: Bash(*)
---

# DocSync — Read & Write Company Documents

CLI tool `docz-cli` for reading, writing, and collaboratively editing files in DocSync (docz.zhenguanyu.com). Outputs to stdout, reads from stdin, and includes realtime collab support for AI agents and terminal editors.

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
npx docz-cli@latest collab cat https://docz.zhenguanyu.com/s/yanfa/docs/guide.md
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
npx docz-cli@latest image upload <local-image>            # upload image to OSS, get public URL
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

### Realtime Collaborative Editing

For AI edits to existing text documents, prefer the `collab` path by default. It connects to the Docz realtime room over WebSocket, so it sees browser/editor content that may not have been flushed to Git yet and avoids the plain-save path that can create `.conflict.web` copies.

Use plain `cat/write` only when the edit is a simple one-shot update where no browser/editor room is expected and only persisted Git content matters.

```bash
npx docz-cli@latest collab cat <space>:<path>                         # read realtime room content, prints collab_hash to stderr
npx docz-cli@latest collab write <space>:<path> '<text>' --base-collab-hash <hash>
npx docz-cli@latest collab write <space>:<path> - --base-collab-hash <hash>
npx docz-cli@latest collab write --no-publish <space>:<path> '<text>' --base-collab-hash <hash>
npx docz-cli@latest collab publish <space>:<path>                     # flush realtime room to repo
npx docz-cli@latest collab bridge                                     # local JSONL bridge for terminal editors
```

**Collaborative edit workflow**:

1. `collab cat <space>:<path>` — read realtime content and capture `collab_hash` from stderr
2. Apply your changes locally
3. `collab write <space>:<path> - --base-collab-hash <hash>` — writes into the realtime room and publishes by default
4. On conflict: re-run `collab cat`, re-apply the change to the latest realtime content, then retry
5. On "Unknown state" / exit code 75: re-read before retrying because the server may already have processed the publish

**Agent-friendly read/write pattern**:

```bash
npx docz-cli@latest collab cat <target> > /tmp/docz-content.md 2> /tmp/docz-meta.txt
```

Edit `/tmp/docz-content.md`. Read `/tmp/docz-meta.txt` to get metadata:

```text
collab_hash: sha256:...
read_only: false
---
```

Extract `collab_hash`, then write back from stdin:

```bash
cat /tmp/docz-content.md | npx docz-cli@latest collab write <target> - --base-collab-hash <hash>
```

For collaborative edits that need to write back, always use normal `collab cat` first so the agent can capture `collab_hash`, then use `collab write --base-collab-hash`. Use `--force` only when intentionally replacing current realtime content. Use `--no-publish` when updating the room without flushing to Git yet. After a successful publish, commit history should show the client source in the commit message, for example `web: collab edit ...` or CLI/client-specific metadata if supported by the server.

**Write strategy**:

- Prefer `collab cat/write` for editing existing DocSync text documents, especially `.md`, `.txt`, `.csv`, `.html`, and docs the user may have open in Web.
- Always use `collab cat/write` when the user mentions collaboration, browser editing, CLI + browser testing, conflicts, shared editing, or reducing conflict files.
- Use plain `cat/write` only for simple one-shot updates where no active editor is expected.
- Do not mix `cat` + `collab write`; use `collab cat` to get `collab_hash`.
- Do not mix `collab cat` + plain `write` unless the user explicitly wants to bypass the realtime room.

**Connection lifecycle**:

- `collab cat`, `collab write`, and `collab publish` are short-lived commands: they open a WebSocket, finish the operation, then close it automatically.
- `collab bridge` is long-lived. It opens a realtime room and keeps the WebSocket alive until `close`, stdin EOF, or process exit.
- There is no CLI-side idle auto-close for bridge. If a test or editor integration needs "edit, wait 10 seconds, then close", the bridge caller must send `close` after waiting.

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
npx docz-cli@latest share create <url> [--expires 7d]      # create share link from normal DocSync URL
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

### Neovim / Terminal Editor Bridge

The repo includes a minimal `docz.nvim` plugin under `plugins/nvim`. It shells out to `docz collab bridge`, which speaks local JSONL over stdio and keeps the Neovim buffer connected to the Docz realtime room. Use bridge only for real terminal editor integrations; for ordinary AI/scripted edits, use `collab cat/write`.

```vim
:DoczCollabOpen <space>:<path>
:DoczCollabPublish
:DoczCollabStatus
:DoczCollabClose
```

Bridge protocol summary for editor integrations:

- `open` opens the realtime room and returns content/hash.
- `local_change` sends local buffer content with `base_hash`.
- `publish` flushes the room to the Docz repository.
- `status` reports connection/read state.
- `close` closes the realtime room.

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
- For active collaborative editing, use `collab cat` + `collab write --base-collab-hash`; this reads and writes the realtime room over WebSocket.
- `write` has a 2MB limit. For larger files, use `upload`.
- `write` detects concurrent edits automatically. If conflict occurs, re-read and retry.
- `collab write` requires `--base-collab-hash` unless `--force` is set. If conflict occurs, re-run `collab cat` and retry against the latest realtime content.
- `rm` moves to trash (recoverable for 30 days), not permanent delete. Use `trash` + `restore` to recover.
- Text files (.md, .csv, .html) work with `cat`. Binary files (images, PDF) use `upload` only.
- To embed images in a Markdown document, first run `image upload <file>` to get a permanent public URL, then write `![alt](url)` into the document. Images go to OSS (not the Space): no Space quota, and visible in share links / blogs without login. Supports png/jpg/webp, max 5MB.
- After writing a file, use `shortlink` to get a clickable URL for the user.
- Backend is Git: every write creates a commit. Use `log` to see history, `diff` to see changes.
- Any DocSync URL can be pasted directly into any command. Supports short URLs (`/s/slug/f/fileId`), path URLs (`/s/slug/path/to/file`), and legacy URLs (`/spaces/id/path`).
- `--quote` creates a selection comment: the quoted text is highlighted in Web UI. The quote must be **plain text** (strip all Markdown formatting like `**`, `#`, `[]()`, `` ` `` before passing). Use 10+ characters to avoid ambiguous matches.
