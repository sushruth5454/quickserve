#!/usr/bin/env bash
# Starts a throwaway local Supabase stack inside a CI runner for E2E: full migration chain from
# supabase/migrations, test OTP logins, demo seeds. Never points at a hosted project.
# Usage: bash scripts/ci/local-supabase.sh   (exports API_URL, ANON_KEY, DB_URL to $GITHUB_ENV when set)
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
# The sms section already exists in config.toml; relax the resend interval for fast test logins.
sed -i 's/^\[auth\.sms\]$/[auth.sms]\nmax_frequency = "1s"/' supabase/config.toml

# Start on 0001 only; later migrations are applied after the legacy seeds (see below).
mkdir -p /tmp/qs-later-migrations
find supabase/migrations -name '*.sql' ! -name '0001_*' -exec mv {} /tmp/qs-later-migrations/ \;

supabase start -x studio,imgproxy,logflare,vector

eval "$(supabase status -o env)"
psql_db() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# seed.sql and seed-full.sql were written for 0001_init.sql and loaded into the hosted demo project
# before later migrations existed. Reproduce that history: 0001, legacy seeds, then every later migration
# (so data backfills run over seeded rows exactly as they did there), then the current all-services seed.
echo "== legacy seeds on 0001"
psql_db -f supabase/seed.sql
psql_db -f supabase/seed-full.sql
mv /tmp/qs-later-migrations/*.sql supabase/migrations/
echo "== applying later migrations"
supabase migration up --local

echo "== all-services seed"
# seed-all-services.sql requires the demo-seed marker inside its own transaction.
sed '0,/^begin;$/s//begin;\nselect set_config('"'"'quickserve.demo_seed'"'"', '"'"'1'"'"', true);/' \
  supabase/seed-all-services.sql | psql_db

if [ -n "${GITHUB_ENV:-}" ]; then
  { echo "LOCAL_API_URL=$API_URL"; echo "LOCAL_ANON_KEY=$ANON_KEY"; echo "LOCAL_DB_URL=$DB_URL"; } >> "$GITHUB_ENV"
fi
echo "== local Supabase ready at $API_URL"

echo '== runtime settings'
psql "$DB_URL" -qtA -f scripts/ci/state-dump.sql
