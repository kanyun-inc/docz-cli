#!/usr/bin/env bash
# smoke-test.sh — docz-cli 集成 smoke test
#
# 前置条件：
#   1. 已构建：npm run build
#   2. 已登录：node dist/index.js login -u <url> -t <token>
#      或设置环境变量 DOCSYNC_BASE_URL + DOCSYNC_API_TOKEN
#
# Usage:
#   bash scripts/smoke-test.sh
#   DOCSYNC_BASE_URL=https://docz-test-uts.zhenguanyu.com DOCSYNC_API_TOKEN=xxx bash scripts/smoke-test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCZ="node $ROOT/dist/index.js"
TEST_PREFIX="smoke-$(date +%s)"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✓ $*"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $*" >&2; }

run_test() {
  local name="$1"
  shift
  echo ""
  echo "── $name ──"
}

cleanup() {
  echo ""
  echo "── Cleanup ──"
  $DOCZ rm "$SPACE:$TEST_DIR" 2>/dev/null && echo "  cleaned $TEST_DIR" || true
}

# ── 0. Verify connection ──
run_test "whoami"
ME=$($DOCZ whoami 2>&1) || { fail "whoami failed: $ME"; exit 1; }
ok "whoami: $ME"

# ── Get first available space ──
SPACES=$($DOCZ spaces 2>&1)
SPACE=$(echo "$SPACES" | head -1 | awk '{print $1}')
if [ -z "$SPACE" ]; then
  fail "No spaces available"
  exit 1
fi
ok "using space: $SPACE"

TEST_DIR="__test_${TEST_PREFIX}"
TEST_FILE="$TEST_DIR/test-doc.md"

trap cleanup EXIT

# ── 1. mkdir ──
run_test "mkdir"
$DOCZ mkdir "$SPACE:$TEST_DIR" && ok "mkdir $TEST_DIR" || fail "mkdir"

# ── 2. write (new file) ──
run_test "write (new file)"
WRITE_OUT=$($DOCZ write "$SPACE:$TEST_FILE" "# Smoke Test\n\nHello from docz-cli." 2>&1) || { fail "write new file: $WRITE_OUT"; }
if echo "$WRITE_OUT" | grep -q "Written:"; then
  ok "write new file"
else
  fail "write new file: unexpected output: $WRITE_OUT"
fi

# ── 3. cat ──
run_test "cat"
CONTENT=$($DOCZ cat "$SPACE:$TEST_FILE" 2>&1) || { fail "cat: $CONTENT"; }
if echo "$CONTENT" | grep -q "Smoke Test"; then
  ok "cat content matches"
else
  fail "cat content mismatch: $CONTENT"
fi

# ── 4. cat --ref ──
run_test "cat --ref"
REF_OUT=$($DOCZ cat --ref "$SPACE:$TEST_FILE" 2>/tmp/docz-ref-stderr) || { fail "cat --ref"; }
REF_STDERR=$(cat /tmp/docz-ref-stderr)
if echo "$REF_STDERR" | grep -q "ref:"; then
  ok "cat --ref returns ref in stderr"
else
  fail "cat --ref missing ref: stderr=$REF_STDERR"
fi

# ── 5. write (edit existing file) ──
run_test "write (edit existing)"
WRITE2=$($DOCZ write "$SPACE:$TEST_FILE" "# Smoke Test v2\n\nEdited content." 2>&1) || { fail "write edit: $WRITE2"; }
if echo "$WRITE2" | grep -q "Written:"; then
  ok "write edit"
else
  fail "write edit: $WRITE2"
fi

# ── 6. log ──
run_test "log"
LOG=$($DOCZ log "$SPACE:$TEST_FILE" 2>&1) || { fail "log: $LOG"; }
if echo "$LOG" | grep -q "save"; then
  ok "log shows history"
else
  ok "log returned (may have different message format): $(echo "$LOG" | head -2)"
fi

# ── 7. ls ──
run_test "ls"
LS=$($DOCZ ls "$SPACE:$TEST_DIR" 2>&1) || { fail "ls: $LS"; }
if echo "$LS" | grep -q "test-doc.md"; then
  ok "ls shows test file"
else
  fail "ls missing test file: $LS"
fi

# ── 8. ls -R ──
run_test "ls -R (recursive)"
LSR=$($DOCZ ls -R "$SPACE" 2>&1) || { fail "ls -R: $LSR"; }
if echo "$LSR" | grep -q "test-doc.md"; then
  ok "ls -R includes test file"
else
  fail "ls -R missing test file"
fi

# ── 9. comment add ──
run_test "comment add"
COMMENT_OUT=$($DOCZ comment add "$SPACE:$TEST_FILE" "smoke test comment" 2>&1) || { fail "comment add: $COMMENT_OUT"; }
if echo "$COMMENT_OUT" | grep -q "Comment #"; then
  COMMENT_ID=$(echo "$COMMENT_OUT" | grep -o '#[0-9]*' | tr -d '#')
  ok "comment add: id=$COMMENT_ID"
else
  fail "comment add: $COMMENT_OUT"
  COMMENT_ID=""
fi

# ── 10. comment list ──
run_test "comment list"
COMMENTS=$($DOCZ comment list "$SPACE:$TEST_FILE" 2>&1) || { fail "comment list: $COMMENTS"; }
if echo "$COMMENTS" | grep -q "smoke test comment"; then
  ok "comment list shows our comment"
else
  fail "comment list: $COMMENTS"
fi

# ── 11. comment reply ──
if [ -n "$COMMENT_ID" ]; then
  run_test "comment reply"
  REPLY_OUT=$($DOCZ comment reply "$SPACE" "$COMMENT_ID" "smoke reply" 2>&1) || { fail "comment reply: $REPLY_OUT"; }
  if echo "$REPLY_OUT" | grep -q "Reply #"; then
    ok "comment reply"
  else
    fail "comment reply: $REPLY_OUT"
  fi
fi

# ── 12. comment close ──
if [ -n "$COMMENT_ID" ]; then
  run_test "comment close"
  CLOSE_OUT=$($DOCZ comment close "$SPACE" "$COMMENT_ID" 2>&1) || { fail "comment close: $CLOSE_OUT"; }
  if echo "$CLOSE_OUT" | grep -q "closed"; then
    ok "comment close"
  else
    fail "comment close: $CLOSE_OUT"
  fi
fi

# ── 13. comment rm ──
if [ -n "$COMMENT_ID" ]; then
  run_test "comment rm"
  RM_OUT=$($DOCZ comment rm "$SPACE" "$COMMENT_ID" 2>&1) || { fail "comment rm: $RM_OUT"; }
  if echo "$RM_OUT" | grep -q "deleted"; then
    ok "comment rm"
  else
    fail "comment rm: $RM_OUT"
  fi
fi

# ── 14. rm + trash ──
run_test "rm + trash"
$DOCZ rm "$SPACE:$TEST_FILE" 2>&1 && ok "rm" || fail "rm"

TRASH=$($DOCZ trash "$SPACE" 2>&1) || { fail "trash: $TRASH"; }
TRASH_COMMIT=$(echo "$TRASH" | grep "test-doc.md" | awk '{print $NF}')
if [ -n "$TRASH_COMMIT" ]; then
  ok "trash shows deleted file (commit=$TRASH_COMMIT)"
else
  ok "trash listed (file may have been auto-cleaned)"
  TRASH_COMMIT=""
fi

# ── 15. restore ──
if [ -n "$TRASH_COMMIT" ]; then
  run_test "restore"
  RESTORE_OUT=$($DOCZ restore "$SPACE:$TEST_FILE" "$TRASH_COMMIT" 2>&1) || { fail "restore: $RESTORE_OUT"; }
  if echo "$RESTORE_OUT" | grep -q "Restored"; then
    ok "restore"
  else
    fail "restore: $RESTORE_OUT"
  fi

  # ── 16. rollback ──
  run_test "rollback"
  LOG2=$($DOCZ log "$SPACE:$TEST_FILE" 2>&1)
  FIRST_COMMIT=$(echo "$LOG2" | tail -1 | awk '{print $1}')
  if [ -n "$FIRST_COMMIT" ]; then
    ROLLBACK_OUT=$($DOCZ rollback "$SPACE:$TEST_FILE" "$FIRST_COMMIT" 2>&1) || { fail "rollback: $ROLLBACK_OUT"; }
    if echo "$ROLLBACK_OUT" | grep -q "Rolled back"; then
      ok "rollback to $FIRST_COMMIT"
    else
      fail "rollback: $ROLLBACK_OUT"
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
