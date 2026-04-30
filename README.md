<div align="center">

# docz-cli

**DocSync CLI & MCP Server — read and write company documents from terminal and AI agents**

[![npm version](https://img.shields.io/npm/v/docz-cli.svg)](https://www.npmjs.com/package/docz-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## Quick Start

```bash
# Login
npx docz-cli@latest login --token <your-token>

# Browse
npx docz-cli@latest spaces
npx docz-cli@latest ls 研发
npx docz-cli@latest cat 研发:docs/guide.md

# Write
npx docz-cli@latest write 吴鹏飞:notes/todo.md '# TODO List'
```

## Features

- **Simple addressing** — `<space>:<path>` format, Space supports name or ID
- **Short URL support** — paste `https://docz.xxx.com/s/slug/f/fileId` directly into cat/ls/log, or generate with `shortlink`
- **Full file operations** — ls, cat, upload, write, mkdir, rm, mv
- **Share links** — create, list, update, access, delete share links from CLI
- **File diff** — view file-level unified diff or space-level change summary
- **Git-backed** — every write creates a commit, built-in version history
- **Trash recovery** — deleted files recoverable within 30 days
- **MCP Server** — built-in stdio MCP server for AI agent integration
- **Zero config** — single token, works immediately

## Installation

**Requirements:** Node.js >= 22.0.0

```bash
npx docz-cli@latest <command>   # Always uses the latest version (recommended)
npm install -g docz-cli          # Or global install, then use `docz` shorthand
```

> **Auto-update**: Using `npx docz-cli@latest` ensures you always run the latest version without manual updates. Global install requires `npm update -g docz-cli` to update.

> Global install registers both `docz-cli` and `docz` commands. Examples below use `docz-cli`; replace with `docz` if installed globally.

## Authentication

Get your API Token:

1. Login to https://docz.zhenguanyu.com (SSO)
2. Go to **Settings → Account → API Tokens** (or visit `/settings` directly)
3. Click **New Token**, name it, copy the token (shown only once)

Then configure:

```bash
# Option 1: login command (saved to ~/.docz/config.json)
docz-cli login --token <your-token>

# Option 2: environment variable
export DOCSYNC_API_TOKEN=<your-token>
```

## Commands

| Command | Description |
|---------|-------------|
| `login --token <t>` | Configure credentials |
| `whoami` | Show current user |
| `spaces` | List all accessible spaces |
| `ls <space>[:<path>]` | List files and folders |
| `cat <space>:<path>` | Read file content |
| `upload <file> <space>[:<dir>]` | Upload local file |
| `write <space>:<path> <content>` | Write content to file (`-` for stdin) |
| `mkdir <space>:<path>` | Create folder |
| `rm <space>:<path>` | Delete file/folder (30-day trash) |
| `mv <space>:<from> <to>` | Rename or move |
| `log <space>[:<path>]` | Show change history |
| `shortlink <space>:<path>` | Get short URL for file |
| `trash <space>` | Show deleted files |
| `diff <space>[:<path>] <commit> [<from>]` | Show changes (file or space level) |
| `share create <space>:<path>` | Create share link |
| `share list <space>` | List share links |
| `share update <space> <link-id>` | Update share link |
| `share cat <token-or-url>` | Read shared file |
| `share info <token-or-url>` | Show share link info |
| `share rm <space> <link-id>` | Delete share link |
| `mcp` | Start MCP stdio server |

## Usage Examples

### Browse

```bash
docz-cli spaces                    # List all spaces
docz-cli ls 研发                    # List root directory
docz-cli ls 研发:docs               # List subdirectory
docz-cli cat 研发:docs/guide.md     # Read file content
```

### Short URL

Generate a short URL for any file, or paste existing short URLs into cat/ls/log:

```bash
# Generate short URL
docz-cli shortlink 闫洪康:AI-Coding技巧总结12.md
# → https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c

# Short URLs work with cat, ls, log
docz-cli cat https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
docz-cli ls https://docz.zhenguanyu.com/s/yanfa
docz-cli log https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c
```

### Write

```bash
docz-cli write 吴鹏飞:notes/todo.md '# TODO List'                    # Write content
echo '# Report' | docz-cli write 吴鹏飞:reports/daily.md -            # From stdin
docz-cli upload ./report.pdf 研发:reports                              # Upload file
docz-cli mkdir 研发:new-project                                        # Create folder
```

### Manage

```bash
docz-cli mv 研发:old.md new.md         # Rename
docz-cli rm 研发:deprecated.md          # Delete (recoverable)
docz-cli log 研发                        # Space history
docz-cli log 研发:docs/guide.md         # File history
docz-cli trash 研发                      # View trash
```

### Share Links

```bash
# Create (with optional expiry and visibility)
docz-cli share create 研发:docs/guide.md --expires 7d --users user@co.com

# List all share links in a space
docz-cli share list 研发
docz-cli share list 研发 --file docs/guide.md    # Filter by file

# Access shared content (token or full URL)
docz-cli share cat xYz123AbC
docz-cli share cat https://docz.zhenguanyu.com/share/xYz123AbC
docz-cli share cat xYz123AbC --raw | grep "部署"  # Raw output for pipes

# View share link info
docz-cli share info xYz123AbC

# Update and delete (requires space context)
docz-cli share update 研发 <link-id> --expires 30d
docz-cli share rm 研发 <link-id>
```

### Diff

```bash
# View what changed in a commit (file level)
docz-cli diff 研发:docs/guide.md af0fb9b

# Compare two commits
docz-cli diff 研发:docs/guide.md af0fb9b b2c3d4e

# Space-level: which files changed in a commit
docz-cli diff 研发 af0fb9b

# Typical workflow: log → pick commit → diff
docz-cli log 研发:docs/guide.md
docz-cli diff 研发:docs/guide.md af0fb9b
```

### Pipes

`cat` outputs to stdout, `write ... -` reads from stdin. Combine with any Unix tool:

```bash
# Search content
docz-cli cat 研发:docs/guide.md | grep "部署"

# Extract CSV columns
docz-cli cat 研发:data.csv | cut -d',' -f1,3 | head -10

# Read → transform → write back
docz-cli cat 吴鹏飞:config.md | sed 's/old/new/g' | docz-cli write 吴鹏飞:config.md -

# Local command output → DocSync
echo "# Generated at $(date)" | docz-cli write 吴鹏飞:notes/auto.md -
cat local-file.md | docz-cli write 吴鹏飞:docs/remote.md -
```

## MCP Server

Built-in MCP server for AI agent integration (Claude Code, Cursor, etc.).

### Configuration

Add to your MCP settings:

```json
{
  "mcpServers": {
    "docz-mcp": {
      "command": "npx",
      "args": ["-y", "docz-cli@latest", "mcp"],
      "env": {
        "DOCSYNC_API_TOKEN": "<your-token>"
      }
    }
  }
}
```

> Using `docz-cli@latest` in MCP config ensures AI agents always use the latest version.

### MCP Tools

| Tool | Description |
|------|-------------|
| `docz_list_spaces` | List all accessible spaces |
| `docz_list_files` | List files in a directory |
| `docz_read_file` | Read file content |
| `docz_upload_file` | Upload/create a file |
| `docz_mkdir` | Create a folder |
| `docz_delete` | Delete file/folder |
| `docz_file_history` | View change history |
| `docz_share_create` | Create share link |
| `docz_share_list` | List share links |
| `docz_share_read` | Read shared file by token |
| `docz_share_info` | View share link info |
| `docz_share_delete` | Delete share link |
| `docz_shortlink` | Get short URL for file |
| `docz_diff` | View file or space diff |

## AI Agent Skill

Install as a [reskill](https://github.com/kanyun-inc/reskill) skill to teach AI agents how to use docz-cli:

```bash
npx reskill install github:kanyun-inc/docz-cli/skills -a claude-code cursor -y
```

The skill provides command reference, usage scenarios, and addressing format documentation so agents can autonomously browse, read, and write DocSync documents.

## API Reference

docz-cli wraps the DocSync REST API:

| Command | API Endpoint |
|---------|-------------|
| `spaces` | `GET /api/spaces` |
| `ls` | `GET /api/spaces/{id}/tree?path=` |
| `cat` | `GET /api/spaces/{id}/blob/{path}` |
| `upload` / `write` | `POST /api/spaces/{id}/files/upload` |
| `mkdir` | `POST /api/spaces/{id}/files/mkdir` |
| `rm` | `POST /api/spaces/{id}/files/delete` |
| `mv` | `POST /api/spaces/{id}/files/rename` |
| `log` | `GET /api/spaces/{id}/log/[{path}]` |
| `trash` | `GET /api/spaces/{id}/trash` |
| `diff` | `GET /api/spaces/{id}/diff/[{path}]?from=&to=` |
| `share create` | `POST /api/spaces/{id}/share-links` |
| `share list` | `GET /api/spaces/{id}/share-links` |
| `share update` | `PUT /api/spaces/{id}/share-links/{linkId}` |
| `share cat` | `GET /api/share/{token}` |
| `share info` | `GET /api/share/{token}/info` |
| `share rm` | `DELETE /api/spaces/{id}/share-links/{linkId}` |
| `shortlink` | `GET /api/spaces/{id}/file-ref?path=` |
| Short URL resolve | `GET /api/spaces/by-slug/{slug}` + `GET /api/file-refs/{fileId}` |

Auth: `Authorization: Bearer <token>`. Backend is Git — every write is a commit.

## Release

Versioning and publishing are automated via [changesets](https://github.com/changesets/changesets) and GitHub Actions.

On a feature branch, add a changeset describing your change:

```bash
pnpm changeset
# pick patch / minor / major + write a summary
# commit the generated .changeset/*.md file in your PR
```

After the PR is merged into `main`, the `Release` workflow opens (or updates) a **`chore: version packages`** PR that bumps `version`, updates `CHANGELOG.md`, and deletes the consumed changesets. Merging that PR triggers the same workflow to `npm publish`, push a `vX.Y.Z` tag, and create a GitHub Release.

No local `npm publish` / OTP required. The workflow uses the repo secret `NPM_TOKEN` (an npm automation token scoped to `docz-cli`).

## License

MIT
