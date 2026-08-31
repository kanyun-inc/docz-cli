## ADDED Requirements

### Requirement: Stable-link routes preserve file-reference semantics
The CLI SHALL classify every `/s/{slug}/f/{fileId}` URL as a file-reference route, including URLs with a trailing slash or additional child path, and MUST NOT fall back to ordinary Space-path parsing after matching the `/f/` route marker.

#### Scenario: Exact stable link
- **WHEN** a command receives `/s/{slug}/f/{fileId}` with optional query or fragment
- **THEN** the CLI resolves the target from the fileId canonical identity

#### Scenario: Stable directory link with child path
- **WHEN** a command receives `/s/{slug}/f/{fileId}/{childPath}` and the fileId identifies an active directory in the same Space
- **THEN** the CLI resolves the target to the canonical directory path joined with the validated child path

#### Scenario: File stable link with child path
- **WHEN** a command receives `/s/{slug}/f/{fileId}/{childPath}` and the fileId identifies a file
- **THEN** the CLI rejects the target before issuing any path-level read or mutation request

#### Scenario: File-reference resolution fails
- **WHEN** the fileId is invalid, deleted, inaccessible, unknown, or belongs to a Space inconsistent with the URL slug
- **THEN** the CLI reports the resolution failure and MUST NOT reinterpret `f/{fileId}/{childPath}` as a Space-root-relative path

### Requirement: Stable-link child paths are safe relative paths
The CLI MUST validate a stable-link child path segment-by-segment after URL decoding and MUST reject input that can escape or ambiguously change the canonical directory target.

#### Scenario: Valid nested Unicode path
- **WHEN** the child path consists of non-empty relative segments including Unicode names
- **THEN** the CLI preserves the segment text and joins it below the canonical directory

#### Scenario: Traversal or encoded separator
- **WHEN** any decoded segment is `.`, `..`, contains `/` or `\\`, is empty, or contains a control character
- **THEN** the CLI rejects the URL before making a path-level API request

### Requirement: URL target commands share canonical resolution
All CLI commands that accept an ordinary Docz URL target SHALL use the same URL classifier and canonical file-reference resolution contract.

#### Scenario: Read command uses child target
- **WHEN** `ls`, `cat`, `log`, `comment list`, `shortlink`, `diff`, or `collab cat` receives a stable directory link with a valid child path
- **THEN** the command reads or diagnoses the canonical child target rather than `f/{fileId}/{childPath}` at the Space root

#### Scenario: Mutation command uses child target
- **WHEN** `write`, `mkdir`, `rm`, `rollback`, `restore`, `comment add`, `share create`, or a collaborative mutation receives a stable directory link with a valid child path
- **THEN** the command submits the canonical child target to its existing API

#### Scenario: Move source uses child target
- **WHEN** `mv` receives a stable directory child URL as its source
- **THEN** the CLI resolves only the source through the canonical resolver and retains the existing Space-root-relative destination contract

#### Scenario: Upload target remains a directory
- **WHEN** `upload` receives a stable directory link with a child path
- **THEN** the CLI treats the resolved canonical child path as the upload directory and retains the local file basename as the uploaded filename

#### Scenario: Space-only command receives a stable child URL
- **WHEN** a command that ultimately needs only a Space receives a stable-link child URL
- **THEN** the CLI still performs canonical file-reference validation, returns the canonical Space only for a valid directory child, and fails closed for an invalid child target

### Requirement: Link metadata diagnoses the canonical child target
`link info` SHALL use file-reference metadata to resolve a stable directory link with a child path and SHALL report metadata for the canonical child target without requiring a service change.

#### Scenario: Canonical child exists
- **WHEN** the stable parent is an accessible active directory and the canonical child exists
- **THEN** `link info --json` reports the canonical `document_path`, `document_status=exists`, and the child's folder type

#### Scenario: Canonical child does not exist
- **WHEN** the stable parent is an accessible active directory but the canonical child does not exist
- **THEN** `link info --json` reports the canonical child `document_path`, `link_status=valid`, and `document_status=not_found`

#### Scenario: Parent cannot safely resolve
- **WHEN** the stable parent is invalid, deleted, inaccessible, not a directory, or its status cannot be confirmed
- **THEN** `link info` preserves the confirmed parent diagnostic facts, reports unconfirmed child facts as unknown or null, and does not diagnose a Space-root `f/...` path

### Requirement: Existing unambiguous URL forms remain compatible
The CLI SHALL preserve behavior for exact stable links, ordinary slug paths, Space roots, legacy URLs, query strings, and fragments.

#### Scenario: Ordinary and legacy paths
- **WHEN** a command receives `/s/{slug}/{path}`, `/s/{slug}`, or `/spaces/{spaceId}/{path}` outside the reserved `/f/` route
- **THEN** the CLI resolves the target using the existing path semantics

#### Scenario: Literal root f path
- **WHEN** a user needs to access a real Space-root-relative path beginning with `f/`
- **THEN** the user can address it unambiguously through `space:path`, while `/s/{slug}/f/...` remains reserved for stable references
