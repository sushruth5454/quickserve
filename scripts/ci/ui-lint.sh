#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

usage() {
  echo "Usage: bash scripts/ci/ui-lint.sh <audit|lane>" >&2
  echo "  audit  Check additions since the redesign baseline 1586a09." >&2
  echo "  lane   Check additions since git merge-base origin/main HEAD." >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

case "$1" in
  audit)
    base=1586a09
    diff_range=("$base...HEAD")
    ;;
  lane)
    if ! git rev-parse --verify --quiet 'origin/main^{commit}' >/dev/null; then
      echo "ui-lint: origin/main is unavailable; fetch origin main before running the lane check." >&2
      exit 2
    fi
    if ! base=$(git merge-base origin/main HEAD); then
      echo "ui-lint: could not find a merge base for origin/main and HEAD." >&2
      exit 2
    fi
    diff_range=("$base" HEAD)
    ;;
  *)
    usage
    exit 2
    ;;
esac

if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  echo "ui-lint: baseline '$base' is unavailable." >&2
  exit 2
fi

status=0
current_file=
line_number=0
pressable_lines=()

while IFS= read -r diff_line; do
  case "$diff_line" in
    '+++ b/'*)
      current_file="${diff_line#+++ b/}"
      ;;
    '@@ '*)
      if [[ "$diff_line" =~ ^@@\ -[0-9]+(,[0-9]+)?\ \+([0-9]+)(,[0-9]+)?\ @@ ]]; then
        line_number="${BASH_REMATCH[2]}"
      fi
      ;;
    '+'*)
      [[ -n "$current_file" ]] || continue
      added_line="${diff_line:1}"

      case "$current_file" in
        app/src/theme/*|app/src/components/RouteErrorBoundary.tsx)
          ;;
        *)
          if [[ "$added_line" =~ \#[0-9A-Fa-f]{6} ]]; then
            printf '%s:%s: hard-coded hex color; use a theme token.\n' "$current_file" "$line_number" >&2
            status=1
          fi
          if [[ "$added_line" == *'fontSize:'* ]]; then
            printf '%s:%s: raw fontSize; use a Text variant.\n' "$current_file" "$line_number" >&2
            status=1
          fi
          if [[ "$added_line" == *'fontFamily:'* ]]; then
            printf '%s:%s: raw fontFamily; use a Text variant.\n' "$current_file" "$line_number" >&2
            status=1
          fi
          ;;
      esac

      if [[ "$added_line" == *'<Pressable'* ]]; then
        pressable_lines+=("$current_file:$line_number")
      fi
      line_number=$((line_number + 1))
      ;;
    ' '*)
      line_number=$((line_number + 1))
      ;;
  esac
done < <(git diff --no-ext-diff --no-renames --unified=0 "${diff_range[@]}" -- 'app/**/*.tsx')

for pressable in "${pressable_lines[@]}"; do
  file="${pressable%%:*}"
  open_line="${pressable##*:}"
  end_line=$((open_line + 5))
  if ! sed -n "${open_line},${end_line}p" "$file" | grep -q 'accessibilityRole'; then
    printf '%s:%s: new <Pressable is missing accessibilityRole within the next 5 lines.\n' "$file" "$open_line" >&2
    status=1
  fi
done

if [[ "$status" -ne 0 ]]; then
  echo "ui-lint: failed." >&2
  exit "$status"
fi

echo "ui-lint: passed ($1 mode)."
