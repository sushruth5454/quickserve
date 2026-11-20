#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")" && pwd)"
source_script="$repo_root/scripts/ci/ui-lint.sh"
fixture_root="$repo_root/.q03-ui-lint-fixtures-$$"
trap 'rm -rf "$fixture_root"' EXIT
mkdir -p "$fixture_root"

fail() {
  echo "FAIL fixture: $*" >&2
  exit 1
}

new_case() {
  local name="$1"
  case_dir="$fixture_root/$name"
  mkdir -p "$case_dir/scripts/ci" "$case_dir/app/src/screens"
  cp "$source_script" "$case_dir/scripts/ci/ui-lint.sh"
  git -C "$case_dir" init -q
  git -C "$case_dir" config user.email fixture@example.invalid
  git -C "$case_dir" config user.name "UI Lint Fixture"
  printf '%s\n' 'export const unchanged = true;' > "$case_dir/app/src/screens/Existing.tsx"
  git -C "$case_dir" add .
  git -C "$case_dir" commit -qm "fixture baseline"
  git -C "$case_dir" update-ref refs/remotes/origin/main HEAD
}

write_file() {
  local path="$1"
  local contents="$2"
  mkdir -p "$case_dir/$(dirname "$path")"
  printf '%s\n' "$contents" > "$case_dir/$path"
}

commit_change() {
  git -C "$case_dir" add .
  git -C "$case_dir" commit -qm "fixture change"
}

expect_pass() {
  local name="$1"
  if ! (cd "$case_dir" && bash scripts/ci/ui-lint.sh lane) > "$fixture_root/output" 2>&1; then
    cat "$fixture_root/output" >&2
    fail "$name should pass"
  fi
  echo "PASS fixture: $name"
}

expect_fail() {
  local name="$1"
  local expected="$2"
  if (cd "$case_dir" && bash scripts/ci/ui-lint.sh lane) > "$fixture_root/output" 2>&1; then
    cat "$fixture_root/output" >&2
    fail "$name should fail"
  fi
  if ! grep -Fq "$expected" "$fixture_root/output"; then
    cat "$fixture_root/output" >&2
    fail "$name did not report '$expected'"
  fi
  echo "PASS fixture: $name"
}

new_case clean-pressable
write_file app/src/screens/Changed.tsx '<Pressable accessibilityRole="button" />'
commit_change
expect_pass "role on opening line"

new_case hex-literal
write_file app/src/screens/Changed.tsx "const color = '#Ab12F0';"
commit_change
expect_fail "hex literal" "app/src/screens/Changed.tsx:1:"

new_case font-size
write_file app/src/screens/Changed.tsx 'const style = { fontSize: 12 };'
commit_change
expect_fail "fontSize literal" "app/src/screens/Changed.tsx:1:"

new_case font-family
write_file app/src/screens/Changed.tsx 'const style = { fontFamily: "Arial" };'
commit_change
expect_fail "fontFamily literal" "app/src/screens/Changed.tsx:1:"

new_case theme-exception
write_file app/src/theme/Allowed.tsx "const color = '#Ab12F0'; const style = { fontSize: 12, fontFamily: 'Arial' };"
commit_change
expect_pass "theme styling exception"

new_case route-error-exception
write_file app/src/components/RouteErrorBoundary.tsx "const color = '#Ab12F0'; const style = { fontSize: 12, fontFamily: 'Arial' };"
commit_change
expect_pass "RouteErrorBoundary styling exception"

new_case missing-role
write_file app/src/screens/Changed.tsx $'<Pressable\n  onPress={go}\n/>'
commit_change
expect_fail "missing accessibilityRole" "app/src/screens/Changed.tsx:1:"

new_case fifth-following-line
write_file app/src/screens/Changed.tsx $'<Pressable\n  one\n  two\n  three\n  four\n  accessibilityRole="button"\n/>'
commit_change
expect_pass "role on fifth following line"

new_case sixth-following-line
write_file app/src/screens/Changed.tsx $'<Pressable\n  one\n  two\n  three\n  four\n  five\n  accessibilityRole="button"\n/>'
commit_change
expect_fail "role on sixth following line" "app/src/screens/Changed.tsx:1:"

new_case unchanged-violation
write_file app/src/screens/Existing.tsx "const color = '#Ab12F0';"
commit_change
git -C "$case_dir" update-ref refs/remotes/origin/main HEAD
write_file app/src/screens/Changed.tsx 'const safe = true;'
commit_change
expect_pass "baseline file unchanged"

new_case changed-line
write_file app/src/screens/Existing.tsx 'const style = { fontFamily: "Arial" };'
commit_change
expect_fail "modified existing line" "app/src/screens/Existing.tsx:1:"

new_case removed-role
write_file app/src/screens/Existing.tsx $'<Pressable\n  accessibilityRole="button"\n  accessibilityLabel="Continue"\n  onPress={go}\n>\n  <Text>Continue</Text>\n</Pressable>'
commit_change
git -C "$case_dir" update-ref refs/remotes/origin/main HEAD
write_file app/src/screens/Existing.tsx $'<Pressable\n  accessibilityLabel="Continue"\n  onPress={go}\n>\n  <Text>Continue</Text>\n</Pressable>'
commit_change
expect_fail "role removed from existing Pressable" "app/src/screens/Existing.tsx:1:"
