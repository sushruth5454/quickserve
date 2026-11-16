# QuickServe Backend Alternatives — Cost, Trade-offs and Migration Effort

| | |
|---|---|
| **Scope** | Backend options for QuickServe (Expo React Native services marketplace, India): stay on Supabase vs. Firebase, AWS, self-hosted Supabase, Appwrite, custom Node.js API on Postgres, Convex |
| **Code/data baseline** | `sushruth5454/quickserve` @ `ed58cf7` (2026-11-16); live test project `nipzptvvtfkusjxigsey` |
| **Evidence sources** | Repository file counts; live database catalog queries; vendor pricing pages and third-party price trackers (dates in References) |
| **Currency** | USD unless stated; vendor prices change — re-check before committing |

---

## Summary

- **Recommendation: stay on Supabase (Pro plan, Mumbai region) for launch.** It costs about **$25/month** plus SMS, needs **no migration**, and every other option is either more expensive to run, more work to operate, or a large rewrite.
- **Firebase is the most expensive move**: an estimated **14–24 weeks** for one experienced developer, because QuickServe's core logic is relational SQL (67 tables, 250 database functions, 85 row-level security policies, 28 triggers, 10 scheduled jobs) and Firebase's database is NoSQL. Firebase phone login also costs **$0.07 per OTP SMS in India** (official price), versus about **₹0.13–0.25** with Indian SMS providers.
- **Cheapest exit if ever needed**: **self-hosted Supabase** (same code, ~1–2 weeks) or **custom Node.js API + Postgres** (~6–12 weeks, full control).
- Effort figures are estimates for **one experienced full-stack developer**, including testing and cutover, not verified by a detailed work breakdown.

---

## What has to move (current system size)

| Component | Size | Evidence | Portability |
|---|---|---|---|
| Database tables | 67 | live `information_schema.tables` (public) | Standard Postgres — portable to any Postgres |
| Database functions (booking state machine, payments, matching, notifications) | 250 | live `pg_proc` (public) | Portable to any Postgres; must be **rewritten** for NoSQL backends |
| Row-level security policies | 85 | live `pg_policies` (public, storage) | Postgres feature; rewritten as API checks or Firebase/Appwrite rules elsewhere |
| Triggers | 28 | live `pg_trigger` | Postgres only |
| Scheduled jobs (pg_cron) | 10 | live `cron.job` | Re-create as cloud schedulers elsewhere |
| SQL migrations | 32 files, 16,832 lines | `supabase/migrations/*.sql` | — |
| `auth.uid()` usages (Supabase login identity inside SQL) | 126 | `supabase/migrations` | Replace with own identity mechanism off-Supabase |
| Storage buckets (photos, documents, portfolio) | 6 | live `storage.buckets` | Move to S3 / Firebase Storage / GCS |
| Realtime-published tables (chat) | 2 | live `pg_publication_tables` | Replace with WebSockets/Firestore listeners off-Supabase |
| Server functions (Deno/TypeScript) | 10 functions, 5,526 lines | `supabase/functions/*` (ai-assistant, create-payment, process-refunds, provider-payout-account, provider-service, razorpay-webhook, release-payouts, review-insights, schedule-reminders, send-notifications) | Mostly portable TypeScript |
| App data layer calling Supabase | 12 files, ~120 call sites (68 `rpc` calls) | `app/src/lib/supabaseApi.ts` (60), `onboarding/supabaseOnboarding.ts` (31), `features/catalogue/api.ts` (9), 9 smaller files | Screens do not call Supabase directly; only the data layer changes |

---

## Findings — option by option

### 1. Supabase (current) — Pro plan, Mumbai region

| | |
|---|---|
| **Monthly cost (launch)** | **$25/project** (includes 100k MAU, 8 GB DB, 100 GB files, 250 GB egress, daily backups 7-day, no pausing; first compute instance covered by included credits). SMS separate: Indian provider ≈ ₹0.13–0.25/OTP + GST |
| **Migration effort** | **None** |
| **Advantages** | Real Postgres (SQL, transactions, PostGIS distance search); auth + storage + realtime + functions + cron in one place; Mumbai region (`ap-south-1`) for latency and data residency; open-source and self-hostable (no lock-in); current code and tests already work |
| **Disadvantages** | Smaller company than Google/AWS; heavy load needs compute add-ons; free tier pauses after 7 days of inactivity (must use Pro in production); SMS provider integration required for real OTP |
| **Best for** | Launch through tens of thousands of active users |

### 2. Firebase (Firestore + Firebase Auth + Cloud Functions + Cloud Storage + FCM)

| | |
|---|---|
| **Monthly cost (launch)** | Blaze pay-as-you-go: Firestore/Functions/Storage near **$0–10** at small scale (Firestore free quota 50k reads + 20k writes/day; Mumbai reads ≈ $0.035/100k). **Phone OTP: $0.07 per SMS in India** (first 10/day free) → ~$70 per 1,000 logins. Auth free to 50k MAU, then $0.0055/MAU |
| **Migration effort** | **14–24 weeks** (largest) |
| **Why so large** | Firestore is NoSQL: 67 relational tables become document collections; 250 SQL functions and 28 triggers become Cloud Functions; 85 RLS policies become Firestore Security Rules; booking/payment state machine loses SQL transactions across tables; PostGIS distance search must be rebuilt (geohash queries); price/insight aggregates need denormalised counters; all ~120 app call sites rewritten to Firestore SDK |
| **Advantages** | Google-scale reliability; excellent mobile SDKs, offline cache and push (FCM free); generous free quotas for reads/writes; huge community |
| **Disadvantages** | NoSQL makes joins, reporting, money/state transactions and analytics harder; costs grow per read (chatty screens get expensive); vendor lock-in (no self-host); expensive phone OTP in India unless you build a custom-token OTP flow with an Indian SMS provider (extra work) |
| **Best for** | New apps designed NoSQL-first, offline-heavy apps |

### 3. AWS custom (RDS Postgres + Cognito or own OTP + Lambda/ECS + S3 + WebSockets)

| | |
|---|---|
| **Monthly cost (launch)** | RDS `db.t4g.micro` ≈ **$11.68/month** at the US rate ($0.016/hr; Mumbai rate not verified, typically a little higher) + storage/backups; Lambda, S3, API Gateway mostly in free/low tiers → roughly **$20–60/month** (estimate) + SMS via Indian provider; plus DevOps time |
| **Migration effort** | **8–14 weeks** |
| **Advantages** | Postgres stays (SQL logic and PostGIS largely reusable); unlimited scale and every AWS service; Mumbai region; what large Indian consumer apps typically build on |
| **Disadvantages** | You assemble and operate everything (networking, security, backups, monitoring, deployments); replace login, RLS, realtime and storage; highest ongoing engineering time |
| **Best for** | Later stage with a dedicated backend/DevOps engineer |

### 4. Self-hosted Supabase (Docker on your own VM/cloud)

| | |
|---|---|
| **Monthly cost (launch)** | VM + disk + backups ≈ **$20–50/month** (estimate) + SMS + your operations time |
| **Migration effort** | **1–2 weeks** (database dump/restore, auth/storage config, SMS, DNS, backups/monitoring) |
| **Advantages** | Same code, same app, same SQL — near-zero rewrite; full control of data and region |
| **Disadvantages** | You run upgrades, security patches, backups, scaling and on-call; no vendor support; easy to get backups/security wrong |
| **Best for** | Exit path if Supabase pricing/terms ever become a problem |

### 5. Appwrite Cloud

| | |
|---|---|
| **Monthly cost (launch)** | Pro **$25/month** (2 TB bandwidth, 150 GB storage, 3.5M function executions, 200k MAU; $10 compute credits included) + SMS |
| **Migration effort** | **10–16 weeks** |
| **Why** | Appwrite's database is a document-style API, not raw Postgres: SQL functions/triggers/RLS move into Appwrite Functions and permissions; geo search and transactions need redesign; app data layer rewritten to Appwrite SDK |
| **Advantages** | Open source, self-hostable; similar all-in-one feature set (auth, storage, functions, realtime); flat pricing |
| **Disadvantages** | Smaller ecosystem than Supabase/Firebase; no direct SQL; same class of rewrite as Firebase for business logic |
| **Best for** | Teams wanting an open-source BaaS without SQL |

### 6. Custom Node.js API (e.g. NestJS/Express) + managed Postgres (Neon, RDS, Render/Railway)

| | |
|---|---|
| **Monthly cost (launch)** | API host ≈ $7–25/month + managed Postgres ≈ $10–40/month (estimates; Neon Launch is pay-as-you-go, e.g. ~$0.106 per compute-hour) + SMS |
| **Migration effort** | **6–12 weeks** |
| **Advantages** | SQL logic and PostGIS reused; full control; hire-friendly stack; no backend vendor lock-in |
| **Disadvantages** | Build login/OTP, access checks (replacing 85 RLS policies), realtime chat, file upload, schedulers yourself; more code to maintain and secure |
| **Best for** | Moving off a BaaS while keeping the database design |

### 7. Convex

| | |
|---|---|
| **Monthly cost (launch)** | Professional **$25 per developer/month** (25M function calls, 50 GB DB, 100 GB files) |
| **Migration effort** | **14–22 weeks** |
| **Advantages** | Reactive TypeScript backend, realtime by default, strong developer experience |
| **Disadvantages** | Document model (no SQL/ORMs); full rewrite of data model and business logic; lock-in; per-seat pricing |
| **Best for** | New TypeScript-first apps, not migrations of SQL-heavy systems |

---

## Comparison matrix

| Option | Launch cost / month | Phone OTP (India) | Migration effort | Keeps SQL logic | Lock-in | Ops burden |
|---|---|---|---|---|---|---|
| **Supabase Pro (current)** | **$25** | Indian SMS provider ₹0.13–0.25 | **0** | Yes | Low (open source) | Low |
| Self-hosted Supabase | $20–50* + ops | Indian provider | 1–2 wks | Yes | None | High |
| Node.js API + Postgres | $17–65* | Indian provider | 6–12 wks | Yes | None | Medium–High |
| AWS custom | $20–60* + ops | Indian provider / SNS | 8–14 wks | Yes | Medium (AWS) | High |
| Appwrite Cloud | $25 | Configurable provider | 10–16 wks | No | Low | Low |
| Convex | $25/dev | Bring your own | 14–22 wks | No | High | Low |
| **Firebase** | $0–10 + SMS | **$0.07/SMS** (~$70 per 1,000) | **14–24 wks** | No | High | Low |

\* Estimates, not vendor-quoted.

### Example: 5,000 logins/month by SMS OTP

| Provider | Cost |
|---|---|
| Firebase phone auth | 5,000 × $0.07 = **$350/month** (≈ ₹29,000 at ₹83/$; minus 10 free/day) |
| Indian SMS provider (MSG91-class) | 5,000 × ₹0.17 ≈ **₹850 + 18% GST ≈ ₹1,000/month** |

---

## Risks / decisions needed

| # | Decision / risk | Recommendation |
|---|---|---|
| 1 | Production must not use the free tier (pauses after 7 days idle, no included backups) | Create a **separate production Supabase project on Pro, region Mumbai** |
| 2 | Real OTP delivery | Choose an Indian SMS provider (MSG91/Gupshup/Kaleyra-class) with DLT registration; integrate with Supabase Auth |
| 3 | Vendor dependence | Keep the exit path cheap: keep logic in SQL + TypeScript, avoid new Supabase-only features where a standard alternative exists |
| 4 | Firebase migration | Not recommended: highest effort, NoSQL fit is poor for bookings/payments, and phone OTP is roughly 20–45× more expensive per message in India |
| 5 | Scale trigger for moving | Revisit only when Supabase compute add-ons cost more than a backend engineer's time to run your own Postgres (typically far beyond launch scale) |

---

## Plan / next steps

1. Create the production Supabase project (Pro, `ap-south-1` Mumbai); apply migrations 0001–0032 without demo seeds.
2. Configure real phone OTP with an Indian SMS provider; remove the test phone number.
3. Set production secrets (Razorpay live keys, Route, webhook secrets, Gemini, Expo push); rotate any access tokens stored in local scripts.
4. Enable backups verification and monitoring (errors, cron job health for payouts/refunds/notifications).
5. Document the exit runbook (self-hosted Supabase or Node + Postgres) so a move is a plan, not a crisis.

---

## Open items / not verified

- Effort estimates are judgement-based for one experienced developer; no detailed work breakdown was done.
- AWS RDS price is the US on-demand rate; the Mumbai rate was not confirmed.
- Self-hosted VM, Node host and AWS monthly totals are estimates, not vendor quotes.
- Firebase Firestore availability in the Mumbai region was not confirmed from Google documentation in this review (Mumbai read pricing is quoted by a third-party calculator).
- Which Indian SMS providers Supabase Auth supports natively vs. through a custom SMS hook was not confirmed.
- INR conversions use ₹83/$ for illustration only.

---

## References

- Supabase pricing — https://supabase.com/pricing
- Supabase regions (Mumbai `ap-south-1`) — https://supabase.com/docs/guides/platform/regions
- Firebase pricing — https://firebase.google.com/pricing
- Google Identity Platform pricing (phone auth SMS, India $0.07) — https://cloud.google.com/identity-platform/pricing
- Firebase cost calculator (Firestore Mumbai read rate) — https://www.countrydevs.com/tools/firebase-cost-calculator
- SMS OTP cost in India (MSG91, Twilio) — https://signops.dev/blog/sms-otp-cost-india/
- Appwrite pricing — https://appwrite.io/pricing (via https://vibes.appwrite.io/pricing)
- Amazon RDS db.t4g.micro pricing — https://cloudprice.net/aws/rds/instances/db.t4g.micro
- Convex pricing — https://frontdeskreview.com/software/backend-as-a-service/convex/
- Neon vs Convex pricing — https://makerkit.dev/pricing-calculator/neon-vs-convex
