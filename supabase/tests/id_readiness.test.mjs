import { createHarness } from './harness.mjs';
import { buildBooking, buildCategory } from './_fixtures.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
let sequence = 1000;
const uuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;

async function insertFixture(table, fixture) {
  const result = await db.query(
    `insert into public.${table}
       select * from jsonb_populate_record(null::public.${table}, $1::jsonb)
     returning *`,
    [JSON.stringify(fixture)],
  );
  return result.rows[0];
}

async function createUser(id = uuid(), name = 'Readiness User') {
  await db.query(
    `insert into auth.users (id, phone)
     values ($1::uuid, $2::text)
     on conflict (id) do nothing`,
    [id, `+1555${id.slice(-8)}`],
  );
  await db.query(
    `update public.profiles
        set full_name = $1::text, role_provider = true
      where id = $2::uuid`,
    [name, id],
  );
  return id;
}

async function createProvider({
  id = uuid(),
  name = 'Readiness Provider',
  city = 'Readiness City',
  timezone = 'Asia/Kolkata',
  kycStatus = 'pending',
  reviewStatus = 'pending',
  submittedAt = '2026-11-20T10:00:00.000Z',
  accountId = null,
  reviewNote = null,
  online = false,
} = {}) {
  await createUser(id, name);
  await db.query(
    `insert into public.providers
       (id, city, timezone, kyc_status, admin_review_status, submitted_at,
        razorpay_account_id, review_note, is_online)
     values
       ($1::uuid, $2::text, $3::text, $4::public.kyc_status, $5::text, $6::timestamptz,
        $7::text, $8::text, $9::boolean)`,
    [id, city, timezone, kycStatus, reviewStatus, submittedAt, accountId, reviewNote, online],
  );
  return id;
}

async function createAdmin() {
  const adminId = await createUser(uuid(), 'Readiness Admin');
  await db.query(
    `insert into public.admins (user_id) values ($1::uuid)`,
    [adminId],
  );
  return adminId;
}

async function addDocumentType(code, label = 'Readiness credential', hasExpiry = true) {
  await db.query(
    `insert into public.document_types (code, label, description, has_expiry, sort_order)
     values ($1::text, $2::text, $3::text, $4::boolean, $5::int)
     on conflict (code) do nothing`,
    [code, label, 'Fixture credential for provider readiness tests', hasExpiry, sequence],
  );
}

async function addCategory(name, requiredDocs = [], overrides = {}) {
  return insertFixture('categories', buildCategory({
    id: uuid(),
    slug: `id-readiness-${sequence++}`,
    name,
    requires_docs: requiredDocs,
    ...overrides,
  }));
}

async function addService(providerId, categoryId) {
  const id = uuid();
  await db.query(
    `insert into public.provider_services
       (id, provider_id, category_id, visit_fee, labour_rate, active)
     values ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6::boolean)`,
    [id, providerId, categoryId, 1200, 2400, true],
  );
  return id;
}

async function launchCategory(categoryId, city = 'Readiness City') {
  await db.query(
    `insert into public.category_cities (category_id, city, live, launched_at)
     values ($1::uuid, $2::text, $3::boolean, $4::timestamptz)`,
    [categoryId, city, true, '2026-11-20T10:00:00.000Z'],
  );
}

async function addDocument({
  id = uuid(),
  providerId,
  code,
  categoryId = null,
  status = 'pending',
  expiresOn = null,
  filePath = `provider-docs/${id}/private.pdf`,
  createdAt = '2026-11-20T10:00:00.000Z',
}) {
  await db.query(
    `insert into public.provider_documents
       (id, provider_id, doc_type, category_id, status, expires_on, file_path, created_at)
     values
       ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::date, $7::text, $8::timestamptz)`,
    [id, providerId, code, categoryId, status, expiresOn, filePath, createdAt],
  );
  return id;
}

async function localToday(providerId) {
  const [row] = (await db.query(
    `select public._provider_local_date($1::uuid, now())::text as local_date`,
    [providerId],
  )).rows;
  return row.local_date;
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

async function requirement(providerId, code, categoryId) {
  const [row] = (await db.query(
    `select *
       from public._provider_document_requirement($1::uuid, $2::text, $3::uuid)`,
    [providerId, code, categoryId],
  )).rows;
  return row;
}

async function onboarding(providerId) {
  const [row] = await as(
    providerId,
    'authenticated',
    `select public.get_my_provider_onboarding() as onboarding`,
  );
  return row.onboarding;
}

async function disableOorvaFlags() {
  await db.query(
    `update public.feature_flags as flags
        set enabled = false
      where left(flags.key, 6) = $1::text`,
    ['oorva_'],
  );
  const flags = (await db.query(
    `select flags.key, flags.enabled
       from public.feature_flags as flags
      where left(flags.key, 6) = $1::text
      order by flags.key`,
    ['oorva_'],
  )).rows;
  ok(
    flags.length > 0 && flags.every((flag) => flag.enabled === false),
    `all Oorva switches are OFF for class-A reads; actual=${JSON.stringify(flags)}`,
  );
}

async function insertAddress(id, userId, line1, city = 'Readiness City') {
  await db.query(
    `insert into public.addresses (id, user_id, label, line1, city, lat, lng)
     values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::double precision, $7::double precision)`,
    [id, userId, 'Booking', line1, city, 17.4, 78.4],
  );
}

await scenario('ID-DOC-A-B', async () => {
  await disableOorvaFlags();
  const providerId = await createProvider({ kycStatus: 'verified', reviewStatus: 'approved', accountId: 'acc_doc_ab' });
  const codeA = 'id_doc_ab_a';
  const codeB = 'id_doc_ab_b';
  await addDocumentType(codeA);
  await addDocumentType(codeB);
  const category = await addCategory('A and B credentials', [codeA, codeB]);
  await addService(providerId, category.id);
  const today = await localToday(providerId);
  const approvedA = await addDocument({
    providerId,
    code: codeA,
    categoryId: category.id,
    status: 'approved',
    expiresOn: today,
  });

  const resultA = await requirement(providerId, codeA, category.id);
  const resultB = await requirement(providerId, codeB, category.id);
  const state = await onboarding(providerId);
  const documentReasons = state.go_live.reasons.filter((reason) => reason.code.startsWith('doc_'));
  ok(
    resultA.satisfied === true
      && resultA.approved_document_id === approvedA
      && resultB.satisfied === false
      && resultB.latest_status === null,
    `A-valid/B-missing requirements are distinct; actual=${JSON.stringify({ resultA, resultB })}`,
  );
  ok(
    documentReasons.some((reason) => reason.code === 'doc_missing' && reason.doc_type === codeB)
      && !documentReasons.some((reason) => reason.code === 'doc_expired' && reason.doc_type === codeA),
    `missing B does not label valid A expired; actual=${JSON.stringify({ documentReasons, go_live: state.go_live })}`,
  );
});

await scenario('ID-DOC-SCOPE', async () => {
  await disableOorvaFlags();
  const providerId = await createProvider();
  const code = 'id_doc_scope';
  await addDocumentType(code);
  const categoryA = await addCategory('Scope category A', [code]);
  const categoryB = await addCategory('Scope category B', [code]);
  await addService(providerId, categoryA.id);
  await addService(providerId, categoryB.id);
  const today = await localToday(providerId);
  const scopedDoc = await addDocument({
    providerId,
    code,
    categoryId: categoryA.id,
    status: 'approved',
    expiresOn: today,
  });

  const scopedA = await requirement(providerId, code, categoryA.id);
  const scopedB = await requirement(providerId, code, categoryB.id);
  const generalDoc = await addDocument({
    providerId,
    code,
    status: 'approved',
    expiresOn: today,
    createdAt: '2026-11-21T10:00:00.000Z',
  });
  const generalB = await requirement(providerId, code, categoryB.id);
  ok(
    scopedA.satisfied === true
      && scopedA.approved_document_id === scopedDoc
      && scopedB.satisfied === false
      && generalB.satisfied === true
      && generalB.approved_document_id === generalDoc,
    `category credential is exact-scope and general credential applies across categories; actual=${JSON.stringify({ scopedA, scopedB, generalB })}`,
  );
});

await scenario('ID-DOC-REPLACE', async () => {
  await disableOorvaFlags();
  const providerId = await createProvider({ kycStatus: 'verified', reviewStatus: 'approved', accountId: 'acc_doc_replace' });
  const code = 'id_doc_replace';
  await addDocumentType(code);
  const category = await addCategory('Replacement credential', [code]);
  await addService(providerId, category.id);
  const today = await localToday(providerId);
  const approvedId = await addDocument({
    providerId,
    code,
    categoryId: category.id,
    status: 'approved',
    expiresOn: today,
    createdAt: '2026-11-20T10:00:00.000Z',
  });
  const pendingId = await addDocument({
    providerId,
    code,
    categoryId: category.id,
    status: 'pending',
    createdAt: '2026-11-21T10:00:00.000Z',
  });

  const result = await requirement(providerId, code, category.id);
  const state = await onboarding(providerId);
  const documentReasons = state.go_live.reasons.filter((reason) => reason.code.startsWith('doc_'));
  ok(
    result.satisfied === true
      && result.approved_document_id === approvedId
      && result.approved_status === 'approved'
      && result.latest_document_id === pendingId
      && result.latest_status === 'pending'
      && result.effective_latest_status === 'pending',
    `valid approval remains separate from pending replacement; actual=${JSON.stringify(result)}`,
  );
  ok(
    !documentReasons.some((reason) => reason.doc_type === code),
    `pending replacement does not negate the still-valid approval; actual=${JSON.stringify({ documentReasons, go_live: state.go_live })}`,
  );
});

await scenario('ID-DOC-EXPIRY', async () => {
  await disableOorvaFlags();
  const providerId = await createProvider({ timezone: 'Pacific/Kiritimati' });
  const expiredCode = 'id_doc_expired';
  const todayCode = 'id_doc_today';
  await addDocumentType(expiredCode);
  await addDocumentType(todayCode);
  const expiredCategory = await addCategory('Expired credential', [expiredCode]);
  const todayCategory = await addCategory('Inclusive expiry credential', [todayCode]);
  await addService(providerId, expiredCategory.id);
  await addService(providerId, todayCategory.id);
  const today = await localToday(providerId);
  const yesterday = shiftDate(today, -1);
  const expiredId = await addDocument({
    providerId,
    code: expiredCode,
    categoryId: expiredCategory.id,
    status: 'approved',
    expiresOn: yesterday,
  });
  const todayId = await addDocument({
    providerId,
    code: todayCode,
    categoryId: todayCategory.id,
    status: 'approved',
    expiresOn: today,
    createdAt: '2026-11-21T10:00:00.000Z',
  });

  const expired = await requirement(providerId, expiredCode, expiredCategory.id);
  const inclusive = await requirement(providerId, todayCode, todayCategory.id);
  const state = await onboarding(providerId);
  ok(
    expired.satisfied === false
      && expired.approved_document_id === null
      && expired.latest_document_id === expiredId
      && expired.latest_status === 'approved'
      && expired.effective_latest_status === 'expired'
      && new Date(expired.expires_on).toISOString().slice(0, 10) === yesterday
      && inclusive.satisfied === true
      && inclusive.approved_document_id === todayId
      && state.server_local_date === today,
    `expiry uses provider-local date inclusively; actual=${JSON.stringify({ today, yesterday, expired, inclusive, server_local_date: state.server_local_date })}`,
  );
});

await scenario('ID-LEGACY-PAYOUT', async () => {
  await disableOorvaFlags();
  const providerId = await createProvider({ accountId: 'acc_legacy_setup' });
  const adminId = await createAdmin();
  const category = await addCategory('Legacy payout service');
  await addService(providerId, category.id);

  const state = await onboarding(providerId);
  const payoutCheck = state.checks.find((check) => check.key === 'payout');
  const [adminProvider] = await as(
    adminId,
    'authenticated',
    `select provider.id, provider.kyc_status, provider.admin_review_status,
            provider.has_payout_account, provider.go_live
       from public.admin_list_providers($1::text, $2::text) as provider
      where provider.id = $3::uuid`,
    ['all', null, providerId],
  );
  const [beneficiaries] = await db.query(
    `select count(*)::int as count
       from public.provider_payout_accounts as payout
      where payout.provider_id = $1::uuid`,
    [providerId],
  ).then((result) => result.rows);
  ok(
    payoutCheck?.ok === true && adminProvider?.has_payout_account === true,
    `legacy identifier completes setup metadata; actual=${JSON.stringify({ payoutCheck, adminProvider })}`,
  );
  ok(
    state.provider?.razorpay_account_id === 'acc_legacy_setup'
      && state.provider?.kyc_status === 'pending'
      && adminProvider?.kyc_status === 'pending'
      && adminProvider?.admin_review_status === 'pending'
      && adminProvider?.go_live?.live === false
      && adminProvider?.go_live?.reasons.some((reason) => reason.code === 'payout_missing')
      && beneficiaries.count === 0,
    `legacy setup does not create a beneficiary or alter KYC/admin/live policy; actual=${JSON.stringify({ provider: state.provider, adminProvider, beneficiaries })}`,
  );
});

await scenario('ID-ADMIN-READ-PRIVACY', async () => {
  await disableOorvaFlags();
  const adminId = await createAdmin();
  const nonAdminId = await createUser(uuid(), 'Readiness Non-admin');
  const providerId = await createProvider({
    name: 'Public Readiness Provider',
    kycStatus: 'verified',
    reviewStatus: 'approved',
    submittedAt: '2026-11-20T10:00:00.000Z',
    accountId: 'acc_private_readiness',
    reviewNote: 'admin-only review explanation',
    online: true,
  });
  const code = 'id_public_credential';
  await addDocumentType(code, 'Public readiness credential');
  const category = await addCategory('Public credential category', [code]);
  await addService(providerId, category.id);
  const today = await localToday(providerId);
  await addDocument({
    providerId,
    code,
    status: 'approved',
    expiresOn: today,
    filePath: 'provider-docs/private-public-profile-fixture.pdf',
  });
  await addDocument({
    providerId,
    code,
    categoryId: category.id,
    status: 'pending',
    filePath: 'provider-docs/admin-category-fixture.pdf',
    createdAt: '2026-11-21T10:00:00.000Z',
  });
  await addDocument({
    providerId,
    code,
    status: 'pending',
    filePath: 'provider-docs/admin-general-fixture.pdf',
    createdAt: '2026-11-22T10:00:00.000Z',
  });
  await db.query(
    `update public.feature_flags as flags
        set enabled = $2::boolean
      where flags.key = $1::text`,
    ['guest_browse', true],
  );
  const [guestBrowse] = await db.query(
    `select flags.enabled
       from public.feature_flags as flags
      where flags.key = $1::text`,
    ['guest_browse'],
  ).then((result) => result.rows);

  const [adminProvider] = await as(
    adminId,
    'authenticated',
    `select provider.*
       from public.admin_list_providers($1::text, $2::text) as provider
      where provider.id = $3::uuid`,
    ['all', null, providerId],
  );
  const queue = await as(
    adminId,
    'authenticated',
    `select queue.document_id, queue.category_id, queue.category_name, queue.file_path
       from public.admin_list_document_queue($1::int) as queue
      where queue.provider_id = $2::uuid
      order by queue.created_at`,
    [100, providerId],
  );
  const [publicRow] = await as(
    null,
    'anon',
    `select public.get_provider_public_profile($1::uuid) as profile`,
    [providerId],
  );
  const deniedProviders = await as(
    nonAdminId,
    'authenticated',
    `select * from public.admin_list_providers($1::text, $2::text)`,
    ['all', null],
  ).then(() => null, (error) => error.message);
  const deniedQueue = await as(
    nonAdminId,
    'authenticated',
    `select * from public.admin_list_document_queue($1::int)`,
    [100],
  ).then(() => null, (error) => error.message);
  const deniedHelper = await as(
    nonAdminId,
    'authenticated',
    `select *
       from public._provider_document_requirement($1::uuid, $2::text, $3::uuid)`,
    [providerId, code, category.id],
  ).then(() => null, (error) => error.message);
  const anonymousHelper = await as(
    null,
    'anon',
    `select *
       from public._provider_document_requirement($1::uuid, $2::text, $3::uuid)`,
    [providerId, code, category.id],
  ).then(() => null, (error) => error.message);
  const [helperPrivileges] = await db.query(
    `select has_function_privilege(
             'authenticated',
             'public._provider_document_requirement(uuid,text,uuid)',
             'execute'
           ) as authenticated,
           has_function_privilege(
             'anon',
             'public._provider_document_requirement(uuid,text,uuid)',
             'execute'
           ) as anon`,
  ).then((result) => result.rows);
  const publicProfile = publicRow.profile;
  const publicText = JSON.stringify(publicProfile);
  const badgeKeys = Object.keys(publicProfile?.badges ?? {}).sort();
  const unsafeTokens = [
    'acc_private_readiness',
    'admin-only review explanation',
    'private-public-profile-fixture.pdf',
    'admin-category-fixture.pdf',
    'admin-general-fixture.pdf',
    'review_note',
    'go_live',
    'file_path',
  ].filter((value) => publicText.includes(value));
  const queueByScope = queue.map((item) => ({
    category_id: item.category_id,
    category_name: item.category_name,
    file_path: item.file_path,
  }));

  ok(
    adminProvider?.go_live?.state === 'live'
      && adminProvider?.review_note === 'admin-only review explanation'
      && adminProvider?.has_payout_account === true
      && !Object.keys(adminProvider ?? {}).some((key) => /account_id|fund_account|file_path/i.test(key)),
    `admin provider projection has canonical private readiness but no payout identifiers; actual=${JSON.stringify(adminProvider)}`,
  );
  ok(
    queue.length === 2
      && queue.some((item) => item.category_id === category.id && item.category_name === category.name)
      && queue.some((item) => item.category_id === null && item.category_name === 'General'),
    `admin queue distinguishes category and general documents; actual=${JSON.stringify(queueByScope)}`,
  );
  ok(guestBrowse?.enabled === true,
    `guest-browse read prerequisite is enabled without changing Oorva switches; actual=${JSON.stringify(guestBrowse)}`);
  ok(
    /admin only/i.test(deniedProviders ?? '')
      && /admin only/i.test(deniedQueue ?? '')
      && /permission denied/i.test(deniedHelper ?? '')
      && /permission denied/i.test(anonymousHelper ?? '')
      && helperPrivileges?.authenticated === false
      && helperPrivileges?.anon === false,
    `non-admin and anonymous private reads are denied; actual=${JSON.stringify({ deniedProviders, deniedQueue, deniedHelper, anonymousHelper, helperPrivileges })}`,
  );
  ok(
    publicProfile?.badges?.id_verified === true
      && publicProfile?.credentials?.includes('Public readiness credential')
      && JSON.stringify(badgeKeys) === JSON.stringify(['id_verified', 'payout_verified', 'police_verified'])
      && unsafeTokens.length === 0,
    `public profile keeps only existing safe badge/credential labels; actual=${JSON.stringify({
      badges: publicProfile?.badges ?? null,
      badgeKeys,
      credentials: publicProfile?.credentials ?? null,
      unsafeTokens,
    })}`,
  );
});

await scenario('ID-JOB-PROJECTION', async () => {
  await disableOorvaFlags();
  const ownerId = await createProvider({
    name: 'Job projection owner',
    kycStatus: 'verified',
    reviewStatus: 'approved',
  });
  const otherProviderId = await createProvider({
    name: 'Unrelated job provider',
    kycStatus: 'verified',
    reviewStatus: 'approved',
  });
  const customerId = await createUser(uuid(), 'Projection customer A');
  const otherCustomerId = await createUser(uuid(), 'Projection customer B');
  const category = await addCategory('Safe job category', [], { max_lead_days: 365 });
  await launchCategory(category.id);
  const ownerServiceId = await addService(ownerId, category.id);
  const otherServiceId = await addService(otherProviderId, category.id);
  const maskedAddressId = uuid();
  const visibleAddressId = uuid();
  const unrelatedAddressId = uuid();
  await insertAddress(maskedAddressId, customerId, 'Private masked address');
  await insertAddress(visibleAddressId, customerId, 'Accepted job address');
  await insertAddress(unrelatedAddressId, otherCustomerId, 'Unrelated provider address');

  const maskedBookingId = uuid();
  const visibleBookingId = uuid();
  const unrelatedBookingId = uuid();
  const maskedBookingTime = '2026-12-20T10:00:00.000Z';
  const visibleBookingTime = '2026-12-20T13:00:00.000Z';
  const fixedCreatedAt = '2026-11-20T10:00:00.000Z';
  const maskedBooking = await insertFixture('bookings', buildBooking({
    id: maskedBookingId,
    customer_id: customerId,
    provider_id: ownerId,
    category_id: category.id,
    provider_service_id: ownerServiceId,
    address_id: maskedAddressId,
    description: 'Accepted but address remains masked',
    status: 'accepted',
    scheduled_at: maskedBookingTime,
    accepted_at: null,
    created_at: fixedCreatedAt,
    updated_at: fixedCreatedAt,
    archetype: 'inspect_quote',
  }));
  const visibleBooking = await insertFixture('bookings', buildBooking({
    id: visibleBookingId,
    customer_id: customerId,
    provider_id: ownerId,
    category_id: category.id,
    provider_service_id: ownerServiceId,
    address_id: visibleAddressId,
    description: 'Accepted with visible address',
    status: 'accepted',
    scheduled_at: visibleBookingTime,
    accepted_at: '2026-11-20T11:00:00.000Z',
    created_at: '2026-11-20T10:01:00.000Z',
    updated_at: fixedCreatedAt,
    archetype: 'inspect_quote',
  }));
  const unrelatedBooking = await insertFixture('bookings', buildBooking({
    id: unrelatedBookingId,
    customer_id: otherCustomerId,
    provider_id: otherProviderId,
    category_id: category.id,
    provider_service_id: otherServiceId,
    address_id: unrelatedAddressId,
    description: 'Unrelated provider booking',
    status: 'accepted',
    scheduled_at: maskedBookingTime,
    accepted_at: '2026-11-20T11:00:00.000Z',
    created_at: '2026-11-20T10:02:00.000Z',
    updated_at: fixedCreatedAt,
    archetype: 'inspect_quote',
  }));

  const jobs = await as(ownerId, 'authenticated', `select * from public.get_provider_jobs()`);
  const businessJobs = await as(
    ownerId,
    'authenticated',
    `select *
       from public.get_my_business_provider_jobs($1::uuid)`,
    [ownerId],
  );
  const otherBusinessJobs = await as(
    ownerId,
    'authenticated',
    `select *
       from public.get_my_business_provider_jobs($1::uuid)`,
    [otherProviderId],
  );
  const expectedKeys = [
    'booking_id', 'status', 'category_name', 'customer_name', 'description',
    'scheduled_at', 'created_at', 'visit_fee', 'area', 'distance_km',
    'address_line', 'lat', 'lng', 'archetype',
  ].sort();
  const jobSummary = jobs.map((job) => ({
    booking_id: job.booking_id,
    address_line: job.address_line,
    lat: job.lat,
    lng: job.lng,
    archetype: job.archetype,
    keys: Object.keys(job).sort(),
  }));
  const businessSummary = businessJobs.map((job) => ({
    booking_id: job.booking_id,
    address_line: job.address_line,
    lat: job.lat,
    lng: job.lng,
    archetype: job.archetype,
    keys: Object.keys(job).sort(),
  }));
  ok(
    jobs.length === 2
      && businessJobs.length === 2
      && otherBusinessJobs.length === 0
      && jobs.every((job) => JSON.stringify(Object.keys(job).sort()) === JSON.stringify(expectedKeys))
      && businessJobs.every((job) => JSON.stringify(Object.keys(job).sort()) === JSON.stringify(expectedKeys))
      && jobSummary.some((job) => job.booking_id === maskedBookingId
        && job.address_line === null && job.lat === null && job.lng === null && job.archetype === maskedBooking.archetype)
      && jobSummary.some((job) => job.booking_id === visibleBookingId
        && job.address_line === 'Accepted job address' && job.lat === 17.4 && job.lng === 78.4 && job.archetype === visibleBooking.archetype)
      && businessSummary.some((job) => job.booking_id === maskedBookingId && job.address_line === null)
      && businessSummary.some((job) => job.booking_id === visibleBookingId && job.address_line === 'Accepted job address'),
    `job projections preserve booking scope, address masking and stored archetype only; actual=${JSON.stringify({
      jobSummary, businessSummary, otherBusinessJobs,
      stored: { masked: maskedBooking.archetype, visible: visibleBooking.archetype, unrelated: unrelatedBooking.archetype },
    })}`,
  );
});

finish();
await db.close();
