# share-link-metadata Spec

## ADDED Requirements

### Requirement: Share links retain a dedicated metadata command
docz-cli SHALL extend `share info <token-or-url>` as the exclusive metadata entry for share links and SHALL keep a share-specific output contract.

#### Scenario: Accessible share is inspected
- **WHEN** the user queries an accessible public or restricted share token
- **THEN** the command reports link lifecycle, access status, visibility, Space name, shared path, document status, share role, creator, expiry, folder type, and current-user Space access

#### Scenario: Ordinary link is rejected
- **WHEN** the user passes an ordinary `/s/...` or `/spaces/...` URL to `share info`
- **THEN** the command reports that the link belongs to `link info`

### Requirement: Share lifecycle and viewer access remain independent
The share result SHALL distinguish whether a token exists from whether the current viewer may use it.

#### Scenario: Restricted share requires login
- **WHEN** a valid restricted share is queried without authentication
- **THEN** `link_status` is `valid`, `access_status` is `login_required`, and protected target metadata is not exposed

#### Scenario: Authenticated viewer is forbidden
- **WHEN** a valid restricted share is queried by a user outside its recipients and Space members
- **THEN** `link_status` is `valid`, `access_status` is `forbidden`, and protected target metadata is not exposed

#### Scenario: Share expired
- **WHEN** the token exists but its expiration is in the past
- **THEN** `link_status` is `expired`, document facts that cannot be safely confirmed remain `unknown`, and the result is not classified as an invalid token

#### Scenario: Share token is unknown
- **WHEN** no share-link record exists for the token
- **THEN** `link_status` is `invalid` and document status is `unknown`

### Requirement: Share target status is reported independently
An accessible share result SHALL report the current state of its target independently from the share lifecycle.

#### Scenario: Active shared target exists
- **WHEN** an accessible link targets an active file or folder
- **THEN** `link_status` is `valid`, `access_status` is `accessible`, and `document_status` is `exists`

#### Scenario: Shared target was deleted
- **WHEN** the share record remains but its target file ref is soft-deleted or no longer active
- **THEN** `link_status` remains `valid` and `document_status` is `not_found`

#### Scenario: Share diagnostic cannot complete
- **WHEN** the request fails before a definitive result or returns malformed data
- **THEN** unconfirmed fields are `unknown` or `null` and the CLI MUST NOT classify the token or document as nonexistent

### Requirement: Share metadata supports human and JSON output
The share command SHALL preserve readable terminal output and add a share-specific stable JSON object.

#### Scenario: Share JSON output requested
- **WHEN** the user runs `share info <token-or-url> --json`
- **THEN** stdout contains one JSON object using share-specific fields including `link_status`, `access_status`, `visibility`, `document_status`, `role`, and `expires_at`
