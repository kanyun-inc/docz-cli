---
"docz-cli": minor
---

Add image upload: new `image upload <file>` CLI command and `docz_upload_image` MCP tool. Uploads png/jpg/webp (max 5MB) to the server's OSS asset storage and returns a permanent public URL with a ready-to-paste Markdown reference — images don't consume Space quota and are visible in share links and blogs without login.
