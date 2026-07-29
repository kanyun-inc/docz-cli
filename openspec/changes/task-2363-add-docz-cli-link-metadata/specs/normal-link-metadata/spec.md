# normal-link-metadata Spec

## ADDED Requirements

### Requirement: Ordinary links have a dedicated metadata command
docz-cli SHALL provide `link info <url>` for ordinary Docz links and MUST reject share links from this entry.

#### Scenario: Stable file link is diagnosed
- **WHEN** the user runs `docz link info https://<host>/s/<slug>/f/<fileId>`
- **THEN** the command reports link status, current-user Space permission, normalized path, document status, Space owner contact, and whether the target is a folder

#### Scenario: Path, root, and legacy links are accepted
- **WHEN** the input is `/s/<slug>/<path>`, `/s/<slug>`, or `/spaces/<spaceId>/<path>`
- **THEN** the command resolves the corresponding Space and path without requiring a stable fileId

#### Scenario: Share link is rejected
- **WHEN** the user passes `/share/<token>` to `link info`
- **THEN** the command reports that the link belongs to `share info` and does not query ordinary-link diagnostics

### Requirement: Link and document status remain independent
The ordinary-link result SHALL represent link lifecycle independently from document existence.

#### Scenario: Active document exists
- **WHEN** a supported link resolves to an active file or folder
- **THEN** `link_status` is `valid` and `document_status` is `exists`

#### Scenario: Document was deleted
- **WHEN** a stable link resolves to a soft-deleted file ref
- **THEN** `link_status` remains `valid`, the historical path and type are retained, and `document_status` is `not_found`

#### Scenario: Stable identifier is invalid
- **WHEN** a fileId cannot be resolved to an active, deleted, or aliased ref
- **THEN** `link_status` is `invalid` and `document_status` is `unknown`

#### Scenario: Space root link
- **WHEN** the target is a Space root
- **THEN** the normalized path is `/`, `document_status` is `not_applicable`, and `is_folder` is `true`

### Requirement: Diagnostic failures preserve unknown state
The command MUST distinguish confirmed negative results from transport, server, and payload failures.

#### Scenario: Current user lacks Space access
- **WHEN** the Space exists and the current API-token user is not an effective member
- **THEN** `space_permission` is `inaccessible` without changing a confirmed link or document status

#### Scenario: Diagnostic cannot complete
- **WHEN** the request times out, is interrupted, returns an unexpected server failure, or contains a malformed payload
- **THEN** all unconfirmed fields are `unknown` or `null`, the command exits non-zero, and it MUST NOT report the link or document as nonexistent

### Requirement: Ordinary metadata supports human and JSON output
The command SHALL provide readable terminal output by default and a stable machine-readable object with `--json`.

#### Scenario: JSON output requested
- **WHEN** the user runs `link info <url> --json`
- **THEN** stdout contains one JSON object with `link_type`, `link_status`, `space_permission`, `document_path`, `document_status`, `space_admin`, and `is_folder`
