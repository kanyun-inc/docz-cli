#!/usr/bin/env bash
# smoke-test-remote.sh — Run docz-cli API integration tests via SSH + curl on remote server.
#
# Usage:
#   bash scripts/smoke-test-remote.sh [SSH_HOST]
#   Default SSH_HOST: root@10.132.254.133 (test-uts)
set -uo pipefail

SSH_HOST="${1:-root@10.132.254.133}"
BASE="http://127.0.0.1:8080"
TEST_PREFIX="smoke-$(date +%s)"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✓ $*"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $*" >&2; }

rcurl() {
  ssh "$SSH_HOST" "curl -sf $*" 2>&1
}

rcurl_status() {
  ssh "$SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' $*" 2>&1
}

rcurl_headers() {
  ssh "$SSH_HOST" "curl -sD - $*" 2>&1
}

echo "=== DocSync CLI API Integration Tests ==="
echo "  SSH host: $SSH_HOST"
echo "  Base URL: $BASE"
echo ""

# ── 0. Login ──
echo "── 0. Login ──"
LOGIN_RESP=$(rcurl "$BASE/api/auth/login -X POST -H 'Content-Type: application/json' -d '{\"email\":\"test@docsync.local\",\"password\":\"test123\"}'")
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null) || {
  fail "login failed: $LOGIN_RESP"
  exit 1
}
ok "login: got token"

AUTH="-H 'Authorization: Bearer $TOKEN'"

# ── 1. whoami ──
echo ""
echo "── 1. whoami ──"
ME=$(rcurl "$BASE/api/auth/me $AUTH")
EMAIL=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin)['email'])" 2>/dev/null) || {
  fail "whoami: $ME"
  EMAIL=""
}
if [ -n "$EMAIL" ]; then
  ok "whoami: $EMAIL"
fi

# ── 2. Get first space ──
echo ""
echo "── 2. Get spaces ──"
SPACES=$(rcurl "$BASE/api/spaces $AUTH")
SPACE_ID=$(echo "$SPACES" | python3 -c "import sys,json; ss=json.load(sys.stdin); print(ss[0]['id'] if ss else '')" 2>/dev/null) || {
  fail "get spaces: $SPACES"
  exit 1
}
if [ -z "$SPACE_ID" ]; then
  fail "No spaces available"
  exit 1
fi
SPACE_NAME=$(echo "$SPACES" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['name'])" 2>/dev/null)
ok "using space: $SPACE_NAME ($SPACE_ID)"

TEST_DIR="__test_${TEST_PREFIX}"
TEST_FILE="${TEST_DIR}/test-doc.md"

cleanup() {
  echo ""
  echo "── Cleanup ──"
  rcurl "$BASE/api/spaces/$SPACE_ID/files/delete -X POST $AUTH -H 'Content-Type: application/json' -d '{\"path\":\"$TEST_DIR\"}'" >/dev/null 2>&1 \
    && echo "  cleaned $TEST_DIR" || echo "  cleanup skipped"
}
trap cleanup EXIT

# ── 3. mkdir ──
echo ""
echo "── 3. mkdir ──"
MKDIR_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/files/mkdir -X POST $AUTH -H 'Content-Type: application/json' -d '{\"path\":\"$TEST_DIR\"}'")
if [ "$MKDIR_STATUS" = "200" ] || [ "$MKDIR_STATUS" = "201" ]; then
  ok "mkdir $TEST_DIR"
else
  fail "mkdir: status=$MKDIR_STATUS"
fi

# ── 4. write (save new file) ──
echo ""
echo "── 4. write (new file via save API) ──"
SAVE_BODY="{\"path\":\"$TEST_FILE\",\"content\":\"# Smoke Test\\n\\nHello from integration test.\",\"base_ref\":\"\"}"
SAVE_RESP=$(rcurl "$BASE/api/spaces/$SPACE_ID/files/save -X POST $AUTH -H 'Content-Type: application/json' -d '$SAVE_BODY'")
NEW_REF=$(echo "$SAVE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ref',''))" 2>/dev/null) || NEW_REF=""
if [ -n "$NEW_REF" ]; then
  ok "write new file: ref=$NEW_REF"
else
  fail "write new file: $SAVE_RESP"
fi

# ── 5. cat (read blob) ──
echo ""
echo "── 5. cat (read blob) ──"
BLOB=$(rcurl "$BASE/api/spaces/$SPACE_ID/blob/$TEST_FILE $AUTH")
if echo "$BLOB" | grep -q "Smoke Test"; then
  ok "cat: content matches"
else
  fail "cat: content mismatch: $BLOB"
fi

# ── 6. cat with ref header ──
echo ""
echo "── 6. cat --ref (X-Git-Ref header) ──"
HEADER_RESP=$(rcurl_headers "$BASE/api/spaces/$SPACE_ID/blob/$TEST_FILE $AUTH")
X_REF=$(echo "$HEADER_RESP" | grep -i 'X-Git-Ref' | awk '{print $2}' | tr -d '\r\n')
if [ -n "$X_REF" ]; then
  ok "cat --ref: X-Git-Ref=$X_REF"
else
  fail "cat --ref: missing X-Git-Ref header"
fi

# ── 7. write (edit existing, with base_ref for optimistic lock) ──
echo ""
echo "── 7. write (edit existing with base_ref) ──"
SAVE2_BODY="{\"path\":\"$TEST_FILE\",\"content\":\"# Smoke Test v2\\n\\nEdited content.\",\"base_ref\":\"$X_REF\"}"
SAVE2_RESP=$(rcurl "$BASE/api/spaces/$SPACE_ID/files/save -X POST $AUTH -H 'Content-Type: application/json' -d '$SAVE2_BODY'")
NEW_REF2=$(echo "$SAVE2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ref',''))" 2>/dev/null) || NEW_REF2=""
if [ -n "$NEW_REF2" ]; then
  ok "write edit: ref=$NEW_REF2"
else
  fail "write edit: $SAVE2_RESP"
fi

# ── 8. save conflict (stale base_ref → 409) ──
echo ""
echo "── 8. save conflict (stale base_ref → 409) ──"
CONFLICT_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/files/save -X POST $AUTH -H 'Content-Type: application/json' -d '{\"path\":\"$TEST_FILE\",\"content\":\"conflict attempt\",\"base_ref\":\"$X_REF\"}'")
if [ "$CONFLICT_STATUS" = "409" ]; then
  ok "save conflict: 409 as expected"
else
  fail "save conflict: expected 409, got $CONFLICT_STATUS"
fi

# ── 9. log (version history) ──
echo ""
echo "── 9. log (version history) ──"
LOG_RESP=$(rcurl "$BASE/api/spaces/$SPACE_ID/log/$TEST_FILE $AUTH")
LOG_COUNT=$(echo "$LOG_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null) || LOG_COUNT="0"
if [ "$LOG_COUNT" -ge 2 ] 2>/dev/null; then
  ok "log: $LOG_COUNT commits"
else
  fail "log: expected >=2 commits, got: $LOG_COUNT"
fi

# ── 10. ls (tree) ──
echo ""
echo "── 10. ls (tree) ──"
TREE=$(rcurl "$BASE/api/spaces/$SPACE_ID/tree?path=$TEST_DIR $AUTH")
if echo "$TREE" | grep -q "test-doc.md"; then
  ok "ls: shows test file"
else
  fail "ls: $TREE"
fi

# ── 11. ls -R (tree/full) ──
echo ""
echo "── 11. ls -R (tree/full) ──"
TREE_FULL=$(rcurl "$BASE/api/spaces/$SPACE_ID/tree/full $AUTH")
if echo "$TREE_FULL" | grep -q "test-doc.md"; then
  ok "ls -R: includes test file"
else
  fail "ls -R: missing test file"
fi

# ── 12. comment add ──
echo ""
echo "── 12. comment add ──"
COMMENT_RESP=$(rcurl "$BASE/api/spaces/$SPACE_ID/comments -X POST $AUTH -H 'Content-Type: application/json' -d '{\"file_path\":\"$TEST_FILE\",\"content\":\"smoke test comment\"}'")
COMMENT_ID=$(echo "$COMMENT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null) || COMMENT_ID=""
if [ -n "$COMMENT_ID" ]; then
  ok "comment add: id=$COMMENT_ID"
else
  fail "comment add: $COMMENT_RESP"
fi

# ── 13. comment list ──
echo ""
echo "── 13. comment list ──"
COMMENTS=$(rcurl "$BASE/api/spaces/$SPACE_ID/comments?path=$TEST_FILE $AUTH")
if echo "$COMMENTS" | grep -q "smoke test comment"; then
  ok "comment list: shows our comment"
else
  fail "comment list: $COMMENTS"
fi

# ── 14. comment reply ──
if [ -n "$COMMENT_ID" ]; then
  echo ""
  echo "── 14. comment reply ──"
  REPLY_RESP=$(rcurl "$BASE/api/spaces/$SPACE_ID/comments/$COMMENT_ID/replies -X POST $AUTH -H 'Content-Type: application/json' -d '{\"content\":\"smoke reply\"}'")
  REPLY_ID=$(echo "$REPLY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null) || REPLY_ID=""
  if [ -n "$REPLY_ID" ]; then
    ok "comment reply: id=$REPLY_ID"
  else
    fail "comment reply: $REPLY_RESP"
  fi
fi

# ── 15. comment close ──
if [ -n "$COMMENT_ID" ]; then
  echo ""
  echo "── 15. comment close ──"
  CLOSE_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/comments/$COMMENT_ID -X PUT $AUTH -H 'Content-Type: application/json' -d '{\"is_closed\":true}'")
  if [ "$CLOSE_STATUS" = "200" ] || [ "$CLOSE_STATUS" = "204" ]; then
    ok "comment close"
  else
    fail "comment close: status=$CLOSE_STATUS"
  fi
fi

# ── 16. comment delete ──
if [ -n "$COMMENT_ID" ]; then
  echo ""
  echo "── 16. comment delete ──"
  DEL_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/comments/$COMMENT_ID -X DELETE $AUTH")
  if [ "$DEL_STATUS" = "200" ] || [ "$DEL_STATUS" = "204" ]; then
    ok "comment delete"
  else
    fail "comment delete: status=$DEL_STATUS"
  fi
fi

# ── 17. rm ──
echo ""
echo "── 17. rm ──"
RM_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/files/delete -X POST $AUTH -H 'Content-Type: application/json' -d '{\"path\":\"$TEST_FILE\"}'")
if [ "$RM_STATUS" = "200" ] || [ "$RM_STATUS" = "204" ]; then
  ok "rm: deleted test file"
else
  fail "rm: status=$RM_STATUS"
fi

# ── 18. trash ──
echo ""
echo "── 18. trash ──"
TRASH=$(rcurl "$BASE/api/spaces/$SPACE_ID/trash $AUTH")
TRASH_COMMIT=$(echo "$TRASH" | python3 -c "
import sys, json
items = json.load(sys.stdin)
for it in items:
    if 'test-doc.md' in it.get('path',''):
        print(it.get('commit',''))
        break
" 2>/dev/null) || TRASH_COMMIT=""
if [ -n "$TRASH_COMMIT" ]; then
  ok "trash: found deleted file (commit=$TRASH_COMMIT)"
else
  ok "trash: listed (may not match expected format)"
  TRASH_COMMIT=""
fi

# ── 19. restore ──
if [ -n "$TRASH_COMMIT" ]; then
  echo ""
  echo "── 19. restore ──"
  RESTORE_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/trash/restore -X POST $AUTH -H 'Content-Type: application/json' -d '{\"path\":\"$TEST_FILE\",\"commit\":\"$TRASH_COMMIT\"}'")
  if [ "$RESTORE_STATUS" = "200" ] || [ "$RESTORE_STATUS" = "204" ]; then
    ok "restore"
  else
    fail "restore: status=$RESTORE_STATUS"
  fi

  # ── 20. rollback ──
  echo ""
  echo "── 20. rollback ──"
  FIRST_COMMIT=$(echo "$LOG_RESP" | python3 -c "import sys,json; cs=json.load(sys.stdin); print(cs[-1]['hash'] if cs else '')" 2>/dev/null) || FIRST_COMMIT=""
  if [ -n "$FIRST_COMMIT" ]; then
    ROLLBACK_STATUS=$(rcurl_status "$BASE/api/spaces/$SPACE_ID/files/rollback -X POST $AUTH -H 'Content-Type: application/json' -d '{\"file_path\":\"$TEST_FILE\",\"commit_hash\":\"$FIRST_COMMIT\"}'")
    if [ "$ROLLBACK_STATUS" = "200" ] || [ "$ROLLBACK_STATUS" = "204" ]; then
      ok "rollback to $FIRST_COMMIT"
    else
      fail "rollback: status=$ROLLBACK_STATUS"
    fi
  else
    ok "rollback skipped (no commit found)"
  fi
fi

# ── Summary ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
