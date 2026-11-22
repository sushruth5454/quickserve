import { readFileSync } from 'node:fs';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const migrationSql = readFileSync(new URL('../migrations/0093_o16_sv03_oorva.sql', import.meta.url), 'utf8');
const bookingChildTables = ['quotes', 'payment_schedule', 'booking_events', 'payments', 'reviews', 'refunds'];

async function createBookingFixture(seed, actors) {
  const category = (await one(`
    insert into public.categories (slug, name, pricing_mode, active)
    values ($1::text, $2::text, 'quote'::public.pricing_mode, true)
    returning id
  `, [`sv-o16-${seed}`, `SV O16 service ${seed}`])).id;
  await db.query(`
    insert into public.providers (
      id, city, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values ($1::uuid, $2::text, 'verified', 'approved', now(), true, false, false)
  `, [actors.provider, `SV O16 City ${seed}`]);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, `SV O16 City ${seed}`]);
  const service = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::int, 0, true)
    returning id
  `, [actors.provider, category, 19900])).id;
  const address = (await one(`
    insert into public.addresses (user_id, line1, city, lat, lng)
    values ($1::uuid, $2::text, $3::text, $4::double precision, $5::double precision)
    returning id
  `, [actors.customer, `22 SV O16 Road ${seed}`, `SV O16 City ${seed}`, 18.5, 73.8])).id;
  const booking = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee, total_amount, coin_discount
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'Readback fixture', 'in_progress'::public.booking_status, 19900, 2900, 19900, 0
    )
    returning id
  `, [actors.customer, actors.provider, category, service, address])).id;
  const quote = (await one(`
    insert into public.quotes (booking_id, version, status, subtotal_other, total)
    values ($1::uuid, 1, 'sent'::public.quote_status, 19900, 19900)
    returning id
  `, [booking])).id;
  const payment = (await one(`
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, funding_source, paid_at
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 10000,
      'paid'::public.payment_status, 'customer'::text, '2026-11-20 10:00:00+00'::timestamptz
    )
    returning id
  `, [booking, quote])).id;
  await db.query(`
    insert into public.payment_schedule (
      booking_id, seq, obligation_type, label, amount, due_rule, status, payment_id
    ) values (
      $1::uuid, 1, 'service', $2::text, 10000, 'at_booking', 'due', $3::uuid
    )
  `, [booking, `SV O16 milestone ${seed}`, payment]);
  await db.query(`
    insert into public.refunds (payment_id, amount, reason, status)
    values ($1::uuid, 1000, 'Readback fixture', 'pending'::public.refund_status)
  `, [payment]);
  await db.query(`
    insert into public.booking_events (booking_id, actor_id, to_status, note)
    values ($1::uuid, $2::uuid, 'in_progress'::public.booking_status, 'Readback fixture')
  `, [booking, actors.provider]);
  await db.query(`
    insert into public.reviews (booking_id, customer_id, provider_id, rating, comment)
    values ($1::uuid, $2::uuid, $3::uuid, 5, $4::text)
  `, [booking, actors.customer, actors.provider, `SV O16 review ${seed}`]);
  return { booking, payment };
}

await scenario('SV-BOOKING-READ-AUTH-01', async () => {
  const customer = uuid(930001);
  const provider = uuid(930002);
  const otherCustomer = uuid(930003);
  const otherProvider = uuid(930004);
  const stranger = uuid(930005);
  await db.query(`
    insert into auth.users (id) values
      ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid), ($5::uuid)
  `, [customer, provider, otherCustomer, otherProvider, stranger]);
  await db.query(`
    update public.profiles set role_provider = true
     where id in ($1::uuid, $2::uuid)
  `, [provider, otherProvider]);

  const owned = await createBookingFixture(9301, { customer, provider });
  const unrelated = await createBookingFixture(9302, { customer: otherCustomer, provider: otherProvider });
  const targets = [owned.booking, unrelated.booking];

  const rls = await db.query(`
    select c.relname, c.relrowsecurity
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any($1::text[])
     order by c.relname
  `, [bookingChildTables]);
  const rlsState = rls.rows.map((row) => ({ table: row.relname, enabled: row.relrowsecurity }));
  check(rlsState.length === bookingChildTables.length && rlsState.every((row) => row.enabled),
    'every subscribed booking child table remains RLS-protected', rlsState);

  const customerCounts = await as(customer, 'authenticated', `
    select json_build_object(
      'quotes', (select count(*)::int from public.quotes where booking_id = any(array[$1::uuid, $2::uuid])),
      'payment_schedule', (select count(*)::int from public.payment_schedule where booking_id = any(array[$1::uuid, $2::uuid])),
      'booking_events', (select count(*)::int from public.booking_events where booking_id = any(array[$1::uuid, $2::uuid])),
      'payments', (select count(*)::int from public.payments where booking_id = any(array[$1::uuid, $2::uuid])),
      'refunds', (select count(*)::int from public.refunds where payment_id = any(array[$3::uuid, $4::uuid]))
    ) as counts
  `, [owned.booking, unrelated.booking, owned.payment, unrelated.payment]).then((rows) => rows[0]);
  const providerCounts = (await as(provider, 'authenticated', `
    select json_build_object(
      'quotes', (select count(*)::int from public.quotes where booking_id = any(array[$1::uuid, $2::uuid])),
      'payment_schedule', (select count(*)::int from public.payment_schedule where booking_id = any(array[$1::uuid, $2::uuid])),
      'booking_events', (select count(*)::int from public.booking_events where booking_id = any(array[$1::uuid, $2::uuid])),
      'payments', (select count(*)::int from public.payments where booking_id = any(array[$1::uuid, $2::uuid])),
      'refunds', (select count(*)::int from public.refunds where payment_id = any(array[$3::uuid, $4::uuid]))
    ) as counts
  `, [owned.booking, unrelated.booking, owned.payment, unrelated.payment]))[0];
  const strangerCounts = (await as(stranger, 'authenticated', `
    select json_build_object(
      'quotes', (select count(*)::int from public.quotes where booking_id = any(array[$1::uuid, $2::uuid])),
      'payment_schedule', (select count(*)::int from public.payment_schedule where booking_id = any(array[$1::uuid, $2::uuid])),
      'booking_events', (select count(*)::int from public.booking_events where booking_id = any(array[$1::uuid, $2::uuid])),
      'payments', (select count(*)::int from public.payments where booking_id = any(array[$1::uuid, $2::uuid])),
      'refunds', (select count(*)::int from public.refunds where payment_id = any(array[$3::uuid, $4::uuid]))
    ) as counts
  `, [owned.booking, unrelated.booking, owned.payment, unrelated.payment]))[0];
  const publicReviews = (await as(stranger, 'authenticated', `
    select count(*)::int as count
      from public.reviews
     where booking_id = any(array[$1::uuid, $2::uuid])
  `, targets))[0];
  const expectedOwnedCounts = {
    quotes: 1,
    payment_schedule: 1,
    booking_events: 1,
    payments: 1,
    refunds: 1,
  };
  const expectedEmptyCounts = {
    quotes: 0,
    payment_schedule: 0,
    booking_events: 0,
    payments: 0,
    refunds: 0,
  };
  check(JSON.stringify(customerCounts.counts) === JSON.stringify(expectedOwnedCounts)
    && JSON.stringify(providerCounts.counts) === JSON.stringify(expectedOwnedCounts),
  'booking participants can read only their own private booking children', {
    expectedOwnedCounts, customer: customerCounts.counts, provider: providerCounts.counts,
  });
  check(JSON.stringify(strangerCounts.counts) === JSON.stringify(expectedEmptyCounts),
    'unrelated actors cannot read private booking children', {
      expectedEmptyCounts, stranger: strangerCounts.counts,
    });
  check(publicReviews.count === 2,
    'reviews keep their existing public policy without widening private booking reads', publicReviews);

  const publicationExists = (await one(`
    select exists (
      select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
    ) as exists
  `)).exists;
  const publishedTables = (await db.query(`
    select tablename
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = any($1::text[])
     order by tablename
  `, [bookingChildTables])).rows.map((row) => row.tablename);
  check(!publicationExists || bookingChildTables.every((table) => publishedTables.includes(table)),
    'existing realtime publication contains only the required protected tables', {
      publicationExists, expected: bookingChildTables, publishedTables,
    });

  await db.exec(migrationSql);
  const repeatedTables = (await db.query(`
    select tablename
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = any($1::text[])
     order by tablename
  `, [bookingChildTables])).rows.map((row) => row.tablename);
  check(!publicationExists || bookingChildTables.every((table) => repeatedTables.includes(table)),
    'publication migration can be applied repeatedly without losing required membership', {
      publicationExists, expected: bookingChildTables, repeatedTables,
    });
  check(!/\bgrant\s+(?:select|all)\b/i.test(migrationSql),
    '0093 adds no table SELECT grants', migrationSql.match(/\bgrant\b[\s\S]{0,80}/gi));
});

finish();
