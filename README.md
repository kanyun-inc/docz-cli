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
npx docz-cli login --token <your-token>

# Browse
npx docz-cli spaces
npx docz-cli ls 研发
npx docz-cli cat 研发:docs/guide.md

# Write
npx docz-cli write 吴鹏飞:notes/todo.md '# TODO List'
```

## Features

- **Simple addressing** — `<space>:<path>` format, Space supports name or ID
- **Full file operations** — ls, cat, upload, write, mkdir, rm, mv
- **Git-backed** — every write creates a commit, built-in version history
- **Trash recovery** — deleted files recoverable within 30 days
- **MCP Server** — built-in stdio MCP server for AI agent integration
- **Zero config** — single token, works immediately

## Installation

**Requirements:** Node.js >= 22.0.0

```bash
npm install -g docz-cli      # Global install
npx docz-cli <command>       # Or use npx directly
```

## Authentication

Get your API Token:

1. Login to https://docz.zhenguanyu.com (SSO)
2. Go to **Settings → Account → API Tokens** (or visit `/settings` directly)
3. Click **New Token**, name it, copy the token (shown only once)

Then configure:

```bash
# Option 1: login command (saved to ~/.docz/config.json)
docz login --token <your-token>

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
| `trash <space>` | Show deleted files |
| `mcp` | Start MCP stdio server |

## Usage Examples

### Browse

```bash
docz spaces                    # List all spaces
docz ls 研发                    # List root directory
docz ls 研发:docs               # List subdirectory
docz cat 研发:docs/guide.md     # Read file content
```

### Write

```bash
docz write 吴鹏飞:notes/todo.md '# TODO List'                    # Write content
echo '# Report' | docz write 吴鹏飞:reports/daily.md -            # From stdin
docz upload ./report.pdf 研发:reports                              # Upload file
docz mkdir 研发:new-project                                        # Create folder
```

### Manage

```bash
docz mv 研发:old.md new.md         # Rename
docz rm 研发:deprecated.md          # Delete (recoverable)
docz log 研发                        # Space history
docz log 研发:docs/guide.md         # File history
docz trash 研发                      # View trash
```

## MCP Server

Built-in MCP server for AI agent integration (Claude Code, Cursor, etc.).

### Configuration

Add to your MCP settings:

```json
{
  "mcpServers": {
    "docsync": {
      "command": "npx",
      "args": ["-y", "docz-cli", "mcp"],
      "env": {
        "DOCSYNC_API_TOKEN": "<your-token>"
      }
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `docsync_list_spaces` | List all accessible spaces |
| `docsync_list_files` | List files in a directory |
| `docsync_read_file` | Read file content |
| `docsync_upload_file` | Upload/create a file |
| `docsync_mkdir` | Create a folder |
| `docsync_delete` | Delete file/folder |
| `docsync_file_history` | View change history |

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

Auth: `Authorization: Bearer <token>`. Backend is Git — every write is a commit.

## License

MIT
