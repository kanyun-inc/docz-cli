#!/usr/bin/env bash
# End-to-end verification for docz mv against a test environment.
#
# Required:
#   DOCSYNC_BASE_URL=https://...
#   DOCSYNC_API_TOKEN=...
set -euo pipefail

: "${DOCSYNC_BASE_URL:?DOCSYNC_BASE_URL is required}"
: "${DOCSYNC_API_TOKEN:?DOCSYNC_API_TOKEN is required}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(node "$ROOT/dist/index.js")
BASE="${DOCSYNC_BASE_URL%/}"
TOKEN="$DOCSYNC_API_TOKEN"
STAMP=$(date +%s)
TMP_FILES=()

api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" "$BASE$path" \
    -H "Authorization: Bearer $TOKEN" "$@"
}

json_path_body() {
  PATH_VALUE="$1" python3 -c \
    'import json,os; print(json.dumps({"path":os.environ["PATH_VALUE"]}, ensure_ascii=False))'
}

SID=$(api GET "/api/spaces" | python3 -c '
import json,sys
spaces=json.load(sys.stdin)
owned=[s for s in spaces if s.get("is_private") and s.get("role") == "owner"]
print((owned or spaces)[0]["id"])
')

SRC="cli-mv-source-$STAMP.md"
TARGET_DIR="cli-mv-target-$STAMP"
TARGET_SUB="$TARGET_DIR/子目录"
NESTED="$TARGET_SUB/新文档.md"
ROOT_PATH="cli-mv-root-$STAMP.md"
MISSING_SRC="cli-mv-missing-$STAMP.md"

cleanup() {
  local path body tmp
  for path in "$ROOT_PATH" "$MISSING_SRC" "$SRC" "$TARGET_DIR"; do
    body=$(json_path_body "$path")
    curl -s -o /dev/null -X POST \
      "$BASE/api/spaces/$SID/files/delete" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" || true
  done
  for tmp in "${TMP_FILES[@]+"${TMP_FILES[@]}"}"; do
    rm -f "$tmp"
  done
}
trap cleanup EXIT

for path in "$TARGET_DIR" "$TARGET_SUB"; do
  api POST "/api/spaces/$SID/files/mkdir" \
    -H "Content-Type: application/json" \
    -d "$(json_path_body "$path")" >/dev/null
done

for spec in "$SRC:cli-source-content" "$MISSING_SRC:missing-source-content"; do
  path="${spec%%:*}"
  content="${spec#*:}"
  tmp=$(mktemp)
  TMP_FILES+=("$tmp")
  printf '%s' "$content" > "$tmp"
  api POST "/api/spaces/$SID/files/upload" \
    -F "file=@$tmp;filename=$path" \
    -F "path=" >/dev/null
done

ready=no
for _ in $(seq 1 20); do
  tree=$(api GET "/api/spaces/$SID/tree/full")
  ready=$(SRC_PATH="$SRC" MISSING_PATH="$MISSING_SRC" python3 -c '
import json,os,sys
paths={entry.get("path") for entry in json.load(sys.stdin)}
expected={os.environ["SRC_PATH"], os.environ["MISSING_PATH"]}
print("yes" if expected <= paths else "no")
' <<< "$tree")
  [ "$ready" = yes ] && break
  sleep 1
done
[ "$ready" = yes ]

"${CLI[@]}" mv "$SID:$SRC" "$NESTED"
SHORT_URL=$("${CLI[@]}" shortlink "$SID:$NESTED")
"${CLI[@]}" mv "$SHORT_URL" "$ROOT_PATH"

ROOT_BODY=$(api GET "/api/spaces/$SID/blob/$ROOT_PATH")
[ "$ROOT_BODY" = "cli-source-content" ]

set +e
MISSING_OUTPUT=$("${CLI[@]}" mv \
  "$SID:$MISSING_SRC" "does-not-exist-$STAMP/new.md" 2>&1)
MISSING_EXIT=$?
set -e
[ "$MISSING_EXIT" -eq 1 ]
grep -q "Destination parent directory does not exist" <<< "$MISSING_OUTPUT"
grep -q "Resolved move:" <<< "$MISSING_OUTPUT"
grep -q "docz mkdir" <<< "$MISSING_OUTPUT"

set +e
INVALID_OUTPUT=$("${CLI[@]}" mv "$SID:$MISSING_SRC" "../bad.md" 2>&1)
INVALID_EXIT=$?
set -e
[ "$INVALID_EXIT" -eq 1 ]
grep -q "invalid destination path" <<< "$INVALID_OUTPUT"

echo "CLI mv E2E passed: space source, short URL source, structured 404, local validation"
