#!/usr/bin/env bash
# Runs every Deno unit test and type-checks every Edge Function entry point.
# Shared by deploy-backend.yml (main) and lane-ci.yml (lane branches) so the two never drift.
set -uo pipefail
cd "$(dirname "$0")/../.."

status=0
mapfile -t test_dirs < <(find supabase/functions -name '*_test.ts' -printf '%h\n' | sort -u)
mapfile -t entrypoints < <(find supabase/functions -mindepth 2 -maxdepth 2 -name index.ts | sort)

if [ "${#test_dirs[@]}" -gt 0 ]; then
  echo "::group::deno test (${#test_dirs[@]} directories)"
  deno test "${test_dirs[@]}" || status=1
  echo "::endgroup::"
fi

echo "::group::deno check (${#entrypoints[@]} functions)"
deno check "${entrypoints[@]}" || status=1
echo "::endgroup::"

[ "$status" -eq 0 ] || echo "::error::Deno tests or type checks failed; see the groups above."
exit "$status"
