# image-upload Specification

## Purpose

上传本地图片到 DocSync 服务端的 OSS 图床（`POST /api/assets/images`），返回永久公网 URL 用于 Markdown 配图。覆盖 CLI 命令（`image upload <file>`）与 MCP 工具（`docz_upload_image`）两种入口。图片不占 Space 配额，URL 无登录态可访问（分享链接/博客可见）。

## Requirements

### Requirement: CLI image upload command
docz-cli SHALL provide an `image upload <file>` command that uploads a local image to the DocSync server's OSS image storage (`POST /api/assets/images`) and prints both the permanent public URL and a ready-to-paste Markdown reference.

#### Scenario: Successful upload
- **WHEN** user runs `docz-cli image upload ./shot.png` with a valid png/jpg/webp file ≤ 5MB
- **THEN** the CLI uploads it via multipart form with the existing Bearer token, and prints the returned URL plus a Markdown snippet `![shot](<url>)`

#### Scenario: Unsupported file type rejected locally
- **WHEN** user runs `image upload ./anim.gif`（or any extension outside png/jpg/jpeg/webp）
- **THEN** the CLI exits with a non-zero code and an error listing supported formats, without sending any request

#### Scenario: Oversized file rejected locally
- **WHEN** the file exceeds 5MB
- **THEN** the CLI exits with a non-zero code and a size-limit error, without sending any request

#### Scenario: Server-side failure surfaced
- **WHEN** the server responds with an error (401 unauthorized / 400 unsupported type / 413 too large / 503 storage unavailable)
- **THEN** the CLI surfaces the HTTP status and response body in the error message

### Requirement: MCP tool docz_upload_image
The built-in MCP server SHALL expose a `docz_upload_image` tool that accepts a local image file path, uploads it to the OSS image storage, and returns the permanent public URL with a Markdown reference, so AI agents can embed images while writing documents.

#### Scenario: Agent uploads an image
- **WHEN** an agent calls `docz_upload_image` with `file_path` pointing to a valid local image
- **THEN** the tool returns a success message containing the public URL and a Markdown snippet `![<name>](<url>)`

#### Scenario: Nonexistent file path
- **WHEN** `file_path` does not exist on the local filesystem
- **THEN** the tool returns a failure message indicating the file was not found, without sending any request

#### Scenario: Local validation mirrors CLI
- **WHEN** the file has an unsupported extension or exceeds 5MB
- **THEN** the tool returns a failure message identical in policy to the CLI validation (png/jpg/jpeg/webp, ≤ 5MB), without sending any request

### Requirement: Image URL is publicly accessible and quota-free
Uploaded images SHALL be stored in OSS (not in any Space) and the returned URL SHALL be accessible without DocSync login, so images render in share links and blog posts.

#### Scenario: Image visible in shared document
- **WHEN** a Markdown document embedding the returned URL is opened via a share link by an unauthenticated visitor
- **THEN** the image loads directly from the OSS public URL without authentication

#### Scenario: No Space quota consumed
- **WHEN** an image is uploaded via `image upload` or `docz_upload_image`
- **THEN** it is stored under the OSS object prefix managed by the server and does not count toward any Space quota
