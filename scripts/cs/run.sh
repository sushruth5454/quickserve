#!/usr/bin/env bash
# Remote test runner inside the Codespace. scripts/cs-test.ps1 pipes this file (from origin/main)
# over stdin, so it works for branches that predate it. Self-contained on purpose.
# Usage: bash -s -- <ref|-> <suite: setup|sql|tsc|jest|app|deno|all> [filters...]
#   ref "-" tests the current checkout (used by devcontainer postCreateCommand with suite "setup").
set -uo pipefail
ref="$1"; suite="$2"; shift 2
cd /workspaces/quickserve || exit 2

# One run at a time: every agent shares this checkout and its node_modules.
exec 9>/tmp/qs-test.lock
flock 9

if [ "$ref" != "-" ]; then
  git fetch -q origin "$ref" || { echo "cs-test: cannot fetch $ref"; exit 2; }
  git checkout -q -f FETCH_HEAD
  git clean -q -fd   # drops stray untracked files; ignored node_modules stay
fi
echo "== testing $ref @ $(git rev-parse --short HEAD)"

# Install dependencies the same way lane CI does, only when a package.json changed.
pkg_hash() { git show "HEAD:$1" 2>/dev/null | sha1sum | cut -c1-40; }
install_deps() {
  mkdir -p /tmp/qs-deps
  local h
  h=$(pkg_hash app/package.json)
  if [ "$h" != "$(cat /tmp/qs-deps/app 2>/dev/null)" ] || [ ! -d app/node_modules ]; then
    echo "== installing app dependencies"
    bash scripts/ci/install-app.sh && echo "$h" > /tmp/qs-deps/app || return 1
  fi
  h=$(pkg_hash supabase/tests/package.json)
  if [ "$h" != "$(cat /tmp/qs-deps/sql 2>/dev/null)" ] || [ ! -d supabase/tests/node_modules ]; then
    echo "== installing SQL test dependencies"
    (cd supabase/tests && rm -f package-lock.json && npm install --no-audit --no-fund --registry https://registry.npmjs.org/) \
      && echo "$h" > /tmp/qs-deps/sql || return 1
  fi
}
install_deps >/tmp/qs-setup.log 2>&1 || { tail -40 /tmp/qs-setup.log; exit 2; }
# install-app.sh rewrites tracked files; restore them so the next branch switch is clean.
git checkout -q -- . 2>/dev/null || true

status=0
run_sql()  { (cd supabase/tests && node run-all.mjs "$@") || status=1; }
run_tsc()  { (cd app && npx tsc --noEmit) || status=1; }
run_jest() { (cd app && npx jest --watchAll=false "$@") || status=1; }
run_deno() {
  command -v deno >/dev/null || { curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null; export PATH="$HOME/.deno/bin:$PATH"; }
  bash scripts/ci/deno-checks.sh || status=1
}

case "$suite" in
  setup) ;;
  sql)   run_sql "$@" ;;
  tsc)   run_tsc ;;
  jest)  run_jest "$@" ;;
  app)   run_tsc; run_jest "$@" ;;
  deno)  run_deno ;;
  all)   run_sql "$@"; run_tsc; run_jest "$@"; run_deno ;;
  *)     echo "cs-test: unknown suite '$suite'"; exit 2 ;;
esac
echo "== cs-test result: $([ "$status" -eq 0 ] && echo PASS || echo FAIL)"
exit "$status"
