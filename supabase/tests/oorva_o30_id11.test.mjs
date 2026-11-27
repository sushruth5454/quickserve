import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
let sequence = 11000;
const uuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;

async function createUser(id, name) {
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
}

async function createAdmin() {
  const id = uuid();
  await createUser(id, 'ID-T11 Admin');
  await db.query(
    `insert into public.admins (user_id) values ($1::uuid)`,
    [id],
  );
  return id;
}

async function createProvider(id) {
  await createUser(id, 'ID-T11 Provider');
  await db.query(
    `insert into public.providers
       (id, city, timezone, kyc_status, admin_review_status, submitted_at,
        razorpay_account_id, review_note, is_online)
     values
       ($1::uuid, $2::text, $3::text, $4::public.kyc_status, $5::text, $6::timestamptz,
        $7::text, $8::text, $9::boolean)`,
    [id, 'ID-T11 City', 'Asia/Kolkata', 'pending', 'pending', '2026-11-20T10:00:00.000Z', 'acc_id11_fixture', 'Existing review note', false],
  );
}

await scenario('ID-T11 review writes remain server-authorized and document reviews terminal', async () => {
  const providerId = uuid();
  const adminId = await createAdmin();
  const nonAdminId = uuid();
  await createUser(nonAdminId, 'ID-T11 Non-admin');
  await createProvider(providerId);

  const deniedProviderReview = await as(
    nonAdminId,
    'authenticated',
    `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
    [providerId, 'approved', null],
  ).then(() => null, (error) => error.message);
  await as(
    adminId,
    'authenticated',
    `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
    [providerId, 'approved', null],
  );
  const [providerAfterReview] = (await db.query(
    `select provider.kyc_status::text as kyc_status,
            provider.admin_review_status,
            provider.review_note
       from public.providers as provider
      where provider.id = $1::uuid`,
    [providerId],
  )).rows;

  const documentId = uuid();
  const documentPath = `${providerId}/private-review.pdf`;
  await db.query(
    `insert into public.document_types (code, label, description, has_expiry, sort_order)
     values ($1::text, $2::text, $3::text, $4::boolean, $5::int)
     on conflict (code) do nothing`,
    ['id11_review_doc', 'ID-T11 review document', 'Private review fixture', false, 111],
  );
  await db.query(
    `insert into public.provider_documents
       (id, provider_id, doc_type, category_id, status, expires_on, file_path, created_at)
     values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::date, $7::text, $8::timestamptz)`,
    [documentId, providerId, 'id11_review_doc', null, 'pending', null, documentPath, '2026-11-20T10:00:00.000Z'],
  );
  await db.query(
    `insert into storage.objects (bucket_id, name) values ($1::text, $2::text)`,
    ['provider-docs', documentPath],
  );

  const deniedDocumentReview = await as(
    nonAdminId,
    'authenticated',
    `select public.admin_review_document($1::uuid, $2::boolean, $3::text, $4::date)`,
    [documentId, false, 'Not authorized', null],
  ).then(() => null, (error) => error.message);
  await as(
    adminId,
    'authenticated',
    `select public.admin_review_document($1::uuid, $2::boolean, $3::text, $4::date)`,
    [documentId, false, 'Document does not match provider details', null],
  );
  const repeatedDocumentReview = await as(
    adminId,
    'authenticated',
    `select public.admin_review_document($1::uuid, $2::boolean, $3::text, $4::date)`,
    [documentId, false, 'Second review attempt', null],
  ).then(() => null, (error) => error.message);
  const [documentAfterReview] = (await db.query(
    `select document.status, document.reject_reason
       from public.provider_documents as document
      where document.id = $1::uuid`,
    [documentId],
  )).rows;
  const pendingRows = await as(
    adminId,
    'authenticated',
    `select queue.document_id
       from public.admin_list_document_queue($1::int) as queue
      where queue.document_id = $2::uuid`,
    [100, documentId],
  );
  const [privateBucket] = (await db.query(
    `select bucket.public
       from storage.buckets as bucket
      where bucket.id = $1::text`,
    ['provider-docs'],
  )).rows;
  const anonymousObjects = await as(
    null,
    'anon',
    `select object.name
       from storage.objects as object
      where object.bucket_id = $1::text
        and object.name = $2::text`,
    ['provider-docs', documentPath],
  );

  ok(
    /admin only/i.test(deniedProviderReview ?? '')
      && /admin only/i.test(deniedDocumentReview ?? ''),
    `non-admin provider and document review writes are denied; actual=${JSON.stringify({ deniedProviderReview, deniedDocumentReview })}`,
  );
  ok(
    providerAfterReview?.kyc_status === 'pending'
      && providerAfterReview?.admin_review_status === 'approved'
      && providerAfterReview?.review_note === null,
    `admin review changes review state only and does not mutate KYC; actual=${JSON.stringify(providerAfterReview)}`,
  );
  ok(
    documentAfterReview?.status === 'rejected'
      && documentAfterReview?.reject_reason === 'Document does not match provider details'
      && /document is not pending review/i.test(repeatedDocumentReview ?? '')
      && pendingRows.length === 0,
    `pending document review is terminal and disappears from the queue; actual=${JSON.stringify({ documentAfterReview, repeatedDocumentReview, pendingRows })}`,
  );
  ok(
    privateBucket?.public === false && anonymousObjects.length === 0,
    `provider document remains private to anonymous readers; actual=${JSON.stringify({ privateBucket, anonymousObjects })}`,
  );
});

finish();
