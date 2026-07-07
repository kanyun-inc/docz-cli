# docz.nvim

Minimal Neovim bridge for Docz collaborative editing.

## Install

Use your preferred plugin manager against this directory, then call:

```lua
require("docz").setup()
```

The plugin shells out to `docz collab bridge`, so the `docz` CLI must be on
`PATH` and logged in.

## Commands

```vim
:DoczCollabOpen <space>:<path>
:DoczCollabPublish
:DoczCollabStatus
:DoczCollabClose
```

Buffer changes are sent to the realtime room. `DoczCollabPublish` flushes the
room to the Docz repository.
