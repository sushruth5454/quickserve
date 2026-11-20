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

if [[ "$1" == audit ]]; then
  if ! old_revision=$(git merge-base "$base" HEAD); then
    echo "ui-lint: could not find a merge base for '$base' and HEAD." >&2
    exit 2
  fi
else
  old_revision="$base"
fi

status=0
current_file=
line_number=0
old_line_number=0
pressable_lines=()
removed_role_lines=()
hunk_files=()
hunk_old_starts=()
hunk_old_counts=()
hunk_new_starts=()
hunk_new_counts=()

while IFS= read -r diff_line; do
  case "$diff_line" in
    '+++ b/'*)
      current_file="${diff_line#+++ b/}"
      ;;
    '--- a/'*)
      ;;
    '@@ '*)
      if [[ "$diff_line" =~ ^@@\ -([0-9]+)(,([0-9]+))?\ \+([0-9]+)(,([0-9]+))?\ @@ ]]; then
        old_line_number="${BASH_REMATCH[1]}"
        hunk_old_count="${BASH_REMATCH[3]:-1}"
        line_number="${BASH_REMATCH[4]}"
        hunk_new_count="${BASH_REMATCH[6]:-1}"
        hunk_files+=("$current_file")
        hunk_old_starts+=("${BASH_REMATCH[1]}")
        hunk_old_counts+=("$hunk_old_count")
        hunk_new_starts+=("${BASH_REMATCH[4]}")
        hunk_new_counts+=("$hunk_new_count")
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
    '-'*)
      [[ -n "$current_file" ]] || continue
      deleted_line="${diff_line:1}"
      if [[ "$deleted_line" == *'accessibilityRole'* ]]; then
        removed_role_lines+=("$current_file:$old_line_number")
      fi
      old_line_number=$((old_line_number + 1))
      ;;
    ' '*)
      line_number=$((line_number + 1))
      old_line_number=$((old_line_number + 1))
      ;;
  esac
done < <(git diff --no-ext-diff --no-renames --unified=0 "${diff_range[@]}" -- 'app/**/*.tsx')

map_old_line_to_head() {
  local target_file="$1"
  local old_line="$2"
  local mapped_line="$old_line"
  local index old_start old_count new_start new_count old_end

  for index in "${!hunk_files[@]}"; do
    [[ "${hunk_files[$index]}" == "$target_file" ]] || continue
    old_start="${hunk_old_starts[$index]}"
    old_count="${hunk_old_counts[$index]}"
    new_start="${hunk_new_starts[$index]}"
    new_count="${hunk_new_counts[$index]}"

    if (( old_count == 0 )); then
      if (( old_start < old_line )); then
        mapped_line=$((mapped_line + new_count))
      fi
      continue
    fi

    old_end=$((old_start + old_count - 1))
    if (( old_end < old_line )); then
      mapped_line=$((mapped_line + new_count - old_count))
    elif (( old_start <= old_line && old_line <= old_end )); then
      printf '0'
      return
    fi
  done

  printf '%s' "$mapped_line"
}

for pressable in "${pressable_lines[@]}"; do
  file="${pressable%%:*}"
  open_line="${pressable##*:}"
  end_line=$((open_line + 5))
  if ! sed -n "${open_line},${end_line}p" "$file" | grep -q 'accessibilityRole'; then
    printf '%s:%s: new <Pressable is missing accessibilityRole within the next 5 lines.\n' "$file" "$open_line" >&2
    status=1
  fi
done

for removed_role in "${removed_role_lines[@]}"; do
  file="${removed_role%:*}"
  role_line="${removed_role##*:}"
  if ! git cat-file -e "$old_revision:$file" 2>/dev/null; then
    continue
  fi
  mapfile -t old_file_lines < <(git show "$old_revision:$file")

  search_start=$((role_line - 5))
  (( search_start > 0 )) || search_start=1
  old_open_line=0
  for ((candidate = search_start; candidate <= role_line && candidate <= ${#old_file_lines[@]}; candidate++)); do
    if [[ "${old_file_lines[$((candidate - 1))]}" == *'<Pressable'* ]]; then
      old_open_line="$candidate"
    fi
  done
  (( old_open_line > 0 )) || continue

  open_line=$(map_old_line_to_head "$file" "$old_open_line")
  [[ "$open_line" =~ ^[0-9]+$ ]] || continue
  (( open_line > 0 )) || continue
  [[ -f "$file" ]] || continue
  if ! sed -n "${open_line}p" "$file" | grep -q '<Pressable'; then
    continue
  fi

  already_checked=0
  for pressable in "${pressable_lines[@]}"; do
    if [[ "$pressable" == "$file:$open_line" ]]; then
      already_checked=1
      break
    fi
  done
  (( already_checked == 0 )) || continue

  end_line=$((open_line + 5))
  if ! sed -n "${open_line},${end_line}p" "$file" | grep -q 'accessibilityRole'; then
    printf '%s:%s: changed <Pressable is missing accessibilityRole within the next 5 lines.\n' "$file" "$open_line" >&2
    status=1
  fi
done

if [[ "$status" -ne 0 ]]; then
  echo "ui-lint: failed." >&2
  exit "$status"
fi

echo "ui-lint: passed ($1 mode)."
