# local-sync-root-discovery Spec

## ADDED Requirements

### Requirement: CLI discovers only the configured synchronization root
docz-cli SHALL provide `local root [--json]` to read the DocSync client's configured `sync_dir` without connecting to daemon IPC, requiring authentication, or enumerating synchronized content.

#### Scenario: Existing synchronization root is reported
- **WHEN** client `config.json` contains an absolute `sync_dir` that exists as a directory
- **THEN** the command outputs that root, reports `exists=true` and `freshness=unknown`, and exits 0

#### Scenario: Configured synchronization root is missing
- **WHEN** client configuration is valid but the configured root does not exist
- **THEN** the command still outputs the configured root, reports `exists=false`, warns the caller, and exits 2

#### Scenario: Client configuration is unavailable or invalid
- **WHEN** `config.json` is missing, malformed, lacks `sync_dir`, or contains a relative path
- **THEN** the command reports a configuration error and exits 1 without printing secrets

#### Scenario: Custom client data directory is used
- **WHEN** `--client-data-dir` or `DOCSYNC_CLIENT_DATA_DIR` is set
- **THEN** the explicit option takes precedence over the environment, which takes precedence over the default `~/.docsync`

### Requirement: Local content requires task-scoped user consent
The Docz skill MUST treat discovering the root separately from permission to inspect synchronized content.

#### Scenario: Root is found before consent
- **WHEN** an Agent discovers an existing local root
- **THEN** it presents the path, warns that freshness is unknown, and asks the user for permission before listing, searching, or reading any child path

#### Scenario: User grants permission
- **WHEN** the user explicitly approves local search
- **THEN** the Agent limits local access to read-only retrieval for the current task

#### Scenario: User declines or cannot confirm
- **WHEN** the user declines local search or no confirmation is available
- **THEN** the Agent does not inspect the local tree and continues with Docz remote APIs

### Requirement: Agents never write synchronized local files
The Docz skill MUST route every mutation through Docz CLI or API commands.

#### Scenario: Existing supported text document is edited
- **WHEN** local search identifies an existing supported text document
- **THEN** the Agent re-reads realtime content with `collab cat` and writes with `collab write --base-collab-hash`

#### Scenario: New text document is created
- **WHEN** the requested target does not exist
- **THEN** the Agent uses plain `write` because collaborative editing cannot create files

#### Scenario: Collaboration is unavailable
- **WHEN** realtime collaboration cannot be used for an existing file
- **THEN** the Agent falls back to remote `cat/write` and MUST NOT modify the local synchronized copy

#### Scenario: Other mutations are requested
- **WHEN** the task uploads, creates a directory, moves, renames, or deletes content
- **THEN** the Agent uses `upload`, `mkdir`, `mv`, or `rm` respectively and performs no local filesystem mutation
