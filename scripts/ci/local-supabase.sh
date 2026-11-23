#!/usr/bin/env bash
# Starts a throwaway local Supabase stack inside a CI runner for E2E: full migration chain from
# supabase/migrations, test OTP logins, demo seeds. Never points at a hosted project.
# Usage: bash scripts/ci/local-supabase.sh (exports local API, anon, DB, and service-role values to $GITHUB_ENV when set)
set -euo pipefail
cd "$(dirname "$0")/../.."

# Runner-only auth overrides: phone OTP with fixed test codes, a dummy SMS provider (test numbers
# never send), and no built-in seeding (seeds run below in a fixed order).
cat >> supabase/config.toml <<'TOML'

[db.seed]
enabled = false

[auth.sms.twilio]
enabled = true
account_sid = "ACe2e00000000000000000000000000000"
message_service_sid = "MGe2e00000000000000000000000000000"
auth_token = "e2e-dummy"

[auth.sms.test_otp]
919999999999 = "123456"
919000000101 = "123456"
919000000102 = "123456"
919000000103 = "123456"
919000000104 = "123456"
919000000201 = "123456"
919000000301 = "123456"
919000000901 = "123456"
919000000902 = "123456"
TOML
if [[ -n "${GUEST_E2E_PHONE:-}" ]]; then
  guest_phone="$(printf '%s' "$GUEST_E2E_PHONE" | tr -cd '0-9')"
  if [[ "$guest_phone" =~ ^[6-9][0-9]{9}$ ]]; then
    guest_phone="91${guest_phone}"
  elif [[ ! "$guest_phone" =~ ^91[6-9][0-9]{9}$ ]]; then
    echo "GUEST_E2E_PHONE must be a 10-digit Indian mobile or 91-prefixed test number" >&2
    exit 1
  fi
  if ! grep -qE "^${guest_phone}[[:space:]]*=" supabase/config.toml; then
    printf '%s = "123456"\n' "$guest_phone" >> supabase/config.toml
  fi
fi
# The sms section already exists in config.toml; relax the resend interval for fast test logins.
sed -i 's/^\[auth\.sms\]$/[auth.sms]\nmax_frequency = "1s"/' supabase/config.toml

# Start on 0001 only; later migrations are applied after the legacy seeds (see below).
mkdir -p /tmp/qs-later-migrations
find supabase/migrations -name '*.sql' ! -name '0001_*' -exec mv {} /tmp/qs-later-migrations/ \;

if ! supabase start -x studio,imgproxy,logflare,vector >/dev/null 2>&1; then
  echo "Failed to start throwaway local Supabase stack" >&2
  exit 1
fi

unset SERVICE_ROLE_KEY
eval "$(supabase status -o env)"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
    echo "::error::Local Supabase status did not provide SERVICE_ROLE_KEY; private Storage tests cannot run" >&2
    exit 1
  fi
  printf '::add-mask::%s\n' "$SERVICE_ROLE_KEY"
  {
    echo "LOCAL_API_URL=$API_URL"
    echo "LOCAL_ANON_KEY=$ANON_KEY"
    echo "LOCAL_DB_URL=$DB_URL"
    printf 'LOCAL_SERVICE_ROLE_KEY=%s\n' "$SERVICE_ROLE_KEY"
  } >> "$GITHUB_ENV"
fi
psql_db() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# seed.sql and seed-full.sql were written for 0001_init.sql and loaded into the hosted demo project
# before later migrations existed. Reproduce that history: 0001, legacy seeds, then every later migration
# (so data backfills run over seeded rows exactly as they did there), then the current all-services seed.
echo "== legacy seeds on 0001"
psql_db -f supabase/seed.sql
psql_db -f supabase/seed-full.sql
mv /tmp/qs-later-migrations/*.sql supabase/migrations/
echo "== applying later migrations"
declare -a original_cli_migrations=()
declare -a normalized_cli_migrations=()
restore_cli_migrations() {
  local i
  for i in "${!normalized_cli_migrations[@]}"; do
    if [[ -f "${normalized_cli_migrations[$i]}" ]]; then
      mv "${normalized_cli_migrations[$i]}" "${original_cli_migrations[$i]}"
    fi
  done
}

# Supabase CLI only accepts numeric migration versions. Map suffix versions (0060a/b, 0088a/b)
# to sortable numeric versions in this throwaway stack, then restore the repository filenames.
normalize_cli_migrations() {
  local migration base version prefix suffix suffix_ascii suffix_order mapped_version normalized
  shopt -s nullglob
  for migration in supabase/migrations/[0-9][0-9][0-9][0-9][a-z]_*.sql; do
    base=${migration##*/}
    version=${base%%_*}
    if [[ ! "$version" =~ ^([0-9]{4})([a-z])$ ]]; then
      echo "Unsupported suffixed migration filename: $base" >&2
      return 1
    fi
    prefix=${BASH_REMATCH[1]}
    suffix=${BASH_REMATCH[2]}
    suffix_ascii=$(LC_ALL=C printf '%d' "'$suffix")
    suffix_order=$((suffix_ascii - 97))
    printf -v mapped_version '%s%02d' "$prefix" "$suffix_order"
    normalized="supabase/migrations/${mapped_version}_${base#*_}"
    if [[ -e "$normalized" ]]; then
      echo "Migration normalization collision: $base -> ${normalized##*/}" >&2
      return 1
    fi
    echo "== normalizing $base as ${normalized##*/} for local Supabase"
    mv "$migration" "$normalized"
    original_cli_migrations+=("$migration")
    normalized_cli_migrations+=("$normalized")
  done
  shopt -u nullglob

  for migration in supabase/migrations/*.sql; do
    base=${migration##*/}
    if [[ ! "$base" =~ ^[0-9]+_.+\.sql$ ]]; then
      echo "Unsupported local E2E migration filename: $base" >&2
      return 1
    fi
  done
}
trap restore_cli_migrations EXIT
normalize_cli_migrations
supabase migration up --local
restore_cli_migrations
trap - EXIT

echo "== all-services and Sangareddy demo seeds"
# Both demo seeds require the demo-seed marker inside their own transaction; Sangareddy copies the
# all-services providers, so it runs second.
demo_seed() {
  sed '0,/^begin;$/s//begin;\nselect set_config('"'"'quickserve.demo_seed'"'"', '"'"'1'"'"', true);/' "$1" | psql_db
}
demo_seed supabase/seed-all-services.sql
demo_seed supabase/seed-sangareddy.sql
echo "== hosted demo admin settings"
psql_db -f supabase/seed-e2e-settings.sql

echo "== local Supabase ready at $API_URL"

echo '== runtime settings'
psql "$DB_URL" -qtA -f scripts/ci/state-dump.sql
