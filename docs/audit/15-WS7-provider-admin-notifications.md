# Nearo audit appendix WS7 — Provider, admin & notifications

> Part of [docs/15](../15-Nearo-Functional-Audit-Report.md). Code-based audit of `main` @ `bfa999f` (2026-11-18), produced by a read-only audit agent and spot-checked by the lead auditor (see doc 15 §1.3 for verified claims and corrections). Status vocabulary and severity scale: doc 15 §1.2. Nothing in this file was tested on a real device or with real users.


Repo: `` (main @ bfa999f). This was a read-only audit: no repo files were edited and no tests or builds were run. The audit read the code and the logs of CI runs 44358292571 and 44365580570.

## Scope & method

- **What was in scope.** Provider and merchant operations: onboarding, verification, area, prices, hours, requests, booking lifecycle, chat, quotes, completion, earnings, payouts, cancellation, reviews, disputes and staff. Admin operations: every screen in `app/app/admin/*` and every admin RPC. Notifications: the outbox, push, the in-app centre, deep links, SMS/OTP and email.
- **Which definition counts.** For every SQL function, the LATEST `create or replace` across the 58 migrations was used. The latest definitions were found with a script that kept the last definition per function name (for example, `admin_set_provider_kyc` comes from `0041_admin_support.sql:319` and `resolve_dispute` from `0021_cancellation_availability_payouts.sql:1016`).
- **Admin RPC matrix.** For every `admin_*` function and every function that calls `_is_admin()`, the audit recorded whether it has a server-side guard and whether it writes `admin_audit_log`. The results are in the Admin investigation section.
- **Notification inventory.** Every `_queue_notification(` call and every raw `insert into public.notifications` across the migrations was extracted (about 60 call sites). Each deep-link payload was checked against `notificationRoute()` (`app/src/lib/unread.ts:98-117`) and against the route files under `app/app/**`.
- **Test evidence used.**
  - SQL tests: backend deploy run **44358292571**. Every `supabase/tests/*.test.mjs` file printed `PASS`, including migration, provider_onboarding, merchant_staff, cancellation_payouts, review_fixes, shops_catalogue, rfq, sports, sports_payments and recurring_plans.
  - Web E2E: run **44365580570**. It ran on the DEMO project with demo payments and the demo API, so UI-only evidence from it is marked **DEMO ONLY**.
  - Jest (`app/**/__tests__`): not executed in either CI run (the only Jest mention in the E2E log is dependency installation, lines 199-202). Jest-only coverage therefore counts as **UNTESTED**.
- **Personas checked.**
  - Individual electrician or plumber: accept → start → quote → complete → get paid.
  - Shop owner: enquiries and RFQs.
  - Sports venue operator: dashboard, requests and payouts.

## Feature matrix

| ID | Feature | Role | Status | Evidence | Notes |
|---|---|---|---|---|---|
| WS7-F01 | Provider onboarding wizard (basics, services, area, hours, portfolio, payouts, submit) | Provider | PASS (server) · DEMO ONLY (UI) | SQL `provider_onboarding.test.mjs` PASS (44358292571). E2E steps `new-pro-basics`, `new-pro-services`, `new-pro-area`, `new-pro-hours`, `new-pro-portfolio`, `new-pro-payouts`, `new-pro-submit` and `new-pro-dashboard-status` passed (44365580570 log l.862-863) | The UI path ran only against the demo API. All copy is English; only login, location and account use i18n (`useT(` found only in `(auth)/login.tsx`, `location.tsx` and `src/components/AccountScreen.tsx`). |
| WS7-F02 | Trust-document upload | Provider | PARTIAL | `PortfolioSection.tsx:137` → `supabaseOnboarding.ts:205-208` (`submit_provider_document`) | Upload always sends `categoryId=null`. The approval gate `_category_docs_ok` (`0009:257-275`) needs admin review, and there is no admin UI for it (see F31). |
| WS7-F03 | Service area | Provider | PASS (server) · DEMO ONLY (UI) | `save_provider_service_area` covered in `provider_onboarding.test.mjs`. E2E `new-pro-area` | Search by place plus a radius picker (`AreaSection.tsx:143-206`). Wording is clear: "Where do you work?" / "How far will you travel?" |
| WS7-F04 | Prices, services and packages | Provider | PASS (server) · DEMO ONLY (UI) | `creator_config.test.mjs`, `home_services_catalogue.test.mjs`. E2E `new-pro-services` | Server validation exists (`_validate_provider_service`, `0009:491`). |
| WS7-F05 | Availability, hours, time off, holiday mode | Provider | PASS (server) · DEMO ONLY (UI) | `set_provider_availability` (6 refs) and `set_provider_paused` (2 refs) in `provider_onboarding.test.mjs`. E2E `new-pro-hours` | "Customers can only book 2-hour visits inside these hours (India time)" (`HoursSection.tsx:108`). |
| WS7-F06 | Online/offline toggle | Provider | UNTESTED | `dashboard.tsx:191-205` → `set_provider_online` (`0001:770`) | No SQL test references `set_provider_online`. |
| WS7-F07 | Receive new job requests | Provider | PASS | SQL assertion "outbox: provider notified of new request with deep link" (`migration.test.mjs:398-399`). Dashboard section "New requests" (`dashboard.tsx:333`) | The 15-minute window is hard-coded on the client (`RESPONSE_WINDOW_MS`, `dashboard.tsx:69`) and on the server (`0001:1606`). |
| WS7-F08 | Accept / decline request | Provider | PASS | `accept_booking` in `booking_core.test.mjs` and `migration.test.mjs`. "outbox: customer notified of acceptance". `decline_booking` in `migration.test.mjs`. E2E `provider-booking-fb4` (demo) | The decline sheet requires a reason (`dashboard.tsx:749-778`). |
| WS7-F09 | Booking lifecycle (start trip, start code, quote, completion code) | Provider | PASS (server) · DEMO ONLY (UI) | `booking_core.test.mjs`, `migration.test.mjs` (`quote_sent`). E2E `dashboard-next-job`, `provider-booking-fb4` | `NEXT_STEP` labels at `dashboard.tsx:59-68`. |
| WS7-F10 | Quote / bill editor | Provider | PASS (server) · DEMO ONLY (UI) | `send_quote` (`0052:925`). E2E `quote-editor-fb4`, `quote-editor-rate-card-pick` | Shows "You receive", commission and GST (`quote/[bookingId].tsx:457-473`). The rule "Parts above ₹500 need a bill photo" (`:414`) is **not enforced server-side**: `send_quote` only stores `bill_photo_url` (`0052:~1000`). |
| WS7-F11 | Booking chat with masking | Provider/Customer | PASS | SQL "outbox: chat preview masks phone and link", "outbox: chat push deep-links to the chat" (`migration.test.mjs`). E2E `booking-chat-send`, `unread-*` (demo) | Business staff use `merchant-job/[id]`. |
| WS7-F12 | Completion evidence | Provider | PARTIAL | End-code OTP only (`complete_booking`, `0023:1199-1226`). Auto-confirm after 24 h or 168 h (`0030:405-440`) | No after-work photos or notes as evidence. The "evidence" search finds only review-insight code. |
| WS7-F13 | Earnings screen | Provider | PARTIAL | E2E `earnings` (demo). `earnings.tsx` | Sports venue payouts are invisible (WS7-04). The "Retrying" label is wrong for failed payouts (WS7-05). |
| WS7-F14 | Settlement / payout tracking | Provider | PARTIAL | `earnings.tsx:236-263, 294-318` | Receivables (money the provider owes after a reversal) are never shown: a search for `receivable` in `app/src` and `app/app` finds nothing. |
| WS7-F15 | Provider cancels a booking | Provider | UNTESTED | `provider_cancel_booking` (`0021:959-985`). No SQL test references it | The customer is not notified (WS7-01). |
| WS7-F16 | Respond to reviews | Provider | NOT IMPLEMENTED | Column `reviews.provider_reply` exists (`0001:278`) and is displayed (`provider/[id].tsx:528`). No RPC or UI writes it | |
| WS7-F17 | Raise a dispute | Provider | NOT IMPLEMENTED | `dispute_booking` asserts "only the customer can raise a dispute" (`0021:997`) | Providers can only open a general support thread (`support_start(p_body, p_booking_id)`). |
| WS7-F18 | Business staff (owner, manager, staff) | Merchant | PARTIAL | SQL `merchant_staff.test.mjs` PASS: "staff can read business work but cannot quote or perform owner actions", "managers cannot perform owner-only actions" | The UI requires a raw UUID ("QuickServe user ID", `merchant-staff.tsx:89-104`) that no screen displays. `remove_business_member` is untested. |
| WS7-F19 | Shop product enquiries | Merchant | PASS | SQL "new enquiries queue a routed notification for the shop owner" (`shops_catalogue.test.mjs:193`). E2E `phase-7a-product-enquiry` (demo) | |
| WS7-F20 | Supplier RFQs | Merchant | PASS | `rfq.test.mjs` (`rfq_received` fan-out to 10 shops, l.216) | |
| WS7-F21 | Sports venue operator management | Venue | PARTIAL | SQL `sports.test.mjs`, `sports_payments.test.mjs` (`decide_sports_booking`) PASS. E2E `phase-6-sports-booking-request` **FAILED** (44365580570) | The form asks for "Latitude", "Longitude" and "Photo URLs (one HTTPS URL per line)" (`sports/manage.tsx:446-450`). There is no payout or earnings view (WS7-04). |
| WS7-F22 | Recurring plans (provider side) | Provider | PARTIAL | SQL "[RP-05] creating a plan notifies the provider" (`recurring_plans.test.mjs:679`) | Notification tap has no destination (WS7-02). |
| WS7-F23 | Travel requests | Provider | PASS | `travel_requests.test.mjs` | Deep link `/provider/dashboard` → `/dashboard` (`unread.ts:102`). |
| WS7-F24 | Proposal inbox (creators) | Provider | PASS (server) · DEMO ONLY (UI) | `proposal_booking.test.mjs`. E2E `proposal-flow-pro-sends-proposal` | |
| WS7-F25 | Business tools: protected invite for an existing client | Provider | PASS (server) · UNTESTED (UI) | `create_byo_invite` in `leakage_programme.test.mjs` | Not in the E2E step list. |
| WS7-F30 | Admin access gating | Admin | PASS | Every admin RPC asserts `_is_admin()`. SQL "non-admin cannot resolve" (`migration.test.mjs:195`), "only admins review documents" (`provider_onboarding.test.mjs:214`), "only admins switch rails" (`:256`). UI gate `admin/_layout.tsx` (`amIAdmin`) | The server is authoritative; the UI redirect is cosmetic. |
| WS7-F31 | Provider verification (KYC / documents) | Admin | PARTIAL | `admin/people.tsx` calls `admin_set_provider_kyc` (`0041:319-337`, audited). **No test** for `admin_set_provider_kyc` | "Verify" never looks at documents or the payout account (WS7-03). `admin_list_document_queue` and `admin_review_document` (`0009:1132-1187`, PASS in SQL) have **no UI**. |
| WS7-F32 | Suspend / restore provider | Admin | PASS | `set_provider_suspended` (`0001:1412`, audited), `migration.test.mjs:492` | The reason is hard-coded: "Suspended from admin portal" (`people.tsx:46`). |
| WS7-F33 | Customer (user) management | Admin | NOT IMPLEMENTED | No admin RPC lists or blocks customers | |
| WS7-F34 | Categories and listings | Admin | PASS | `home_services_catalogue.test.mjs` ("admin only" ×3). `admin_upsert_category`, `admin_set_category_active`, `admin_reorder_categories` are all audited | |
| WS7-F35 | Shop approval | Admin | PASS | `admin_set_shop_status` in `shops_catalogue.test.mjs`. E2E `phase-7a-admin-approves-submitted-shop` (demo) | |
| WS7-F36 | Sports venue approval | Admin | PASS | `admin_set_venue_status` in `sports.test.mjs` (×3) | |
| WS7-F37 | Bookings list and detail | Admin | UNTESTED | `admin_list_bookings` and `admin_get_booking` (`0041:342-410`). No tests | The detail view omits refunds, payouts, transfers, reversals, receivables and event actors (see the Admin investigation section). |
| WS7-F38 | Resolve disputes | Admin | PARTIAL | `resolve_dispute` (`0021:1016-1093`, audited). SQL full and partial refund paths pass (`migration.test.mjs:195-197, 311, 380`) | The UI offers only "No refund — release provider" and "Full refund — reverse payout" (`admin/booking/[id].tsx:67-68`). The server-supported `partial_refund` is not offered. |
| WS7-F39 | Refunds, payouts, settlements, retries, receivables | Admin | NOT IMPLEMENTED | No admin screen references payout or refund except dispute copy. `retry_payout` is granted to service_role only (`0001:2036-2057`) and is unaudited. `admin_add_provider_receivable` exists without UI | Failed money operations need a SQL console. |
| WS7-F40 | Commission | Admin | PASS | `admin_set_commission` in `prd_v2.test.mjs` (×8) and `review_fixes.test.mjs`; audited | |
| WS7-F41 | Coins | Admin | PASS | `admin_adjust_coins` in `coins_config.test.mjs` and `seva_coins.test.mjs`; audited | |
| WS7-F42 | Promotions / coupons | Admin | NOT IMPLEMENTED | 0 matches for `promo_code`, `promotion` or `coupon` in migrations | No recommendation to add one; noted only. |
| WS7-F43 | Support inbox | Admin | PASS | "a support message notifies the admin", "the admin reply is readable by the customer" (`review_fixes.test.mjs:508-512`) | `support_send` and `support_set_status` do not write `admin_audit_log`. That is acceptable because the messages are themselves the record; status changes are not recorded. |
| WS7-F44 | Review moderation | Admin | NOT IMPLEMENTED | No hide, flag or report RPC | |
| WS7-F45 | Notification delivery monitoring | Admin | NOT IMPLEMENTED | Outbox status and `last_error` exist (`0007:187-210`) but are not exposed to admins | |
| WS7-F46 | Reports | Admin | PARTIAL | `admin_dashboard` (tested, `review_fixes.test.mjs`), `admin_ai_usage_dashboard` (`ai_usage.test.mjs`), `admin_rfq_dashboard`, `admin_shop_dashboard` | The first metric is labelled "Revenue" but shows `gmv_period_paise` (`admin/index.tsx:33`). |
| WS7-F47 | Feature flags | Admin | PASS | E2E `admin-feature-registry` (demo). `admin_set_feature` in `coins_config.test.mjs`, `prd_v2.test.mjs` and `review_fixes.test.mjs`; audited | |
| WS7-F48 | Rules | Admin | PASS | `admin_set_rules` in `addendum_foundations.test.mjs` (×8); audited | |
| WS7-F49 | Geography | Admin | PASS | `admin_upsert_geo` in `managed_geography.test.mjs`; audited | |
| WS7-F50 | AI config and usage | Admin | PASS | `ai_usage.test.mjs` | Read-only dashboard. |
| WS7-F51 | Audit-log viewer | Admin | NOT IMPLEMENTED | `admin_audit_log` table exists (`0001:54`) and is written by 25+ RPCs. No reader RPC or screen | |
| WS7-F52 | Sports bookings, payments and refunds | Admin | NOT IMPLEMENTED | `admin/sports.tsx` only lists venues and activities (l.41-75) | |
| WS7-F60 | Push delivery pipeline (outbox → Expo) | System | PASS (server) · BLOCKED (real devices) | SQL "delivery: claim returns tokens…", "delivery: failures retry with backoff", "delivery: users without devices are skipped" (`migration.test.mjs`) | `app/app.json` has no `extra.eas.projectId` and no `googleServicesFile`, so `registerForPush` returns `'unavailable'` (`push.ts:88-89`) unless the build injects them. Needs a real-device check. |
| WS7-F61 | In-app notification centre | All | PASS | `list_my_notifications` (×3) and `mark_notifications_read` (×2) in `review_fixes.test.mjs` | Rows deleted after 30 days even if unread (`0007:536`). |
| WS7-F62 | Notification deep links | All | PARTIAL | Jest `unread.test.ts` exists but did not run in CI (UNTESTED) | Recurring payload/route contract is broken (WS7-02). |
| WS7-F63 | SMS OTP login | All | BLOCKED | `supabase/config.toml:9-10` only has `[auth.sms] enable_signup = true`; no provider configured in the repo. Docs say MSG91/Twilio plus DLT is needed (`docs/04…:10`, `docs/06…:273`) | |
| WS7-F64 | Email notifications | All | NOT IMPLEMENTED | No email sender in `supabase/functions` | Fine for this market; noted. |
| WS7-F65 | Notifications in the user's language (Telugu) | All | NOT IMPLEMENTED | `preferred_language` exists (`0045:2-3`) but no notification builder reads it (search: only `0045` matches) | |

## Findings

| ID | Title | Type | Severity | Gate | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| WS7-01 | Customer is never told when the provider cancels; system cancellations are reported as "The customer cancelled" | Technical defect | P1 | before pilot | `_on_booking_event_notify` maps `to_status='cancelled'` only to `v_to := b.provider_id` with the text "The customer cancelled the … booking." (`0007:358-361`), then skips it when `v_to = actor` (`0007:385-387`). `provider_cancel_booking` → `_cancel_booking_by_policy` sets the actor to `b.provider_id` (`0021:933-934`), so no row is queued for anyone. When the actor is null (system), the provider gets the wrong "customer cancelled" text. | Branch on the actor. Provider or system cancellation → notify the customer ("{Pro} cancelled your {category} booking. Your refund of ₹X is on the way."). Customer cancellation → notify the provider. System cancellation → notify both with neutral text. |
| WS7-02 | Recurring-plan notifications have no tap destination; providers would be sent to the customer route | Technical defect | P2 | before pilot | Server payloads carry `recurring_schedule_id` (for example `0057:1090-1094`, `:1131-1147`, `:1242`, `:1409`, `:1482`). `notificationRoute` reads only `d.plan_id` (`unread.ts:109-110`). The Jest test uses `plan_id` (`unread.test.ts:115-116`), so the test passes against a contract the server never emits. Provider-side kinds (`recurring_plan_requested`, `_paused`, `_resumed`, `_cancelled`, `_visit_skipped` without a booking) would route to `/recurring/<id>` (the customer screen) rather than `/recurring/provider/[id]`. | Add `url` to every recurring payload server-side (`/recurring/provider/<id>` for the provider recipient, `/recurring/<id>` for the customer). Make `notificationRoute` also accept `recurring_schedule_id`. Fix the Jest fixture. |
| WS7-03 | Admin "Verify" makes a provider live without reviewing documents or a payout account; the payout gateway can later overwrite admin decisions | Business logic | P1 | before accepting real payments | `people.tsx:41-42` confirm text: "Their submitted documents will be marked verified." `admin_set_provider_kyc` only updates `providers.kyc_status` (`0041:330-333`) and never touches `provider_documents`. `_provider_is_live` needs `kyc_status='verified'` (`0009:290`), so a provider with no payout beneficiary becomes bookable and the payout fails later. The same column is written by the gateway webhook `sync_provider_payout_status` (`0058:174-244`, sets `kyc_status = v_new`), so an admin "Reject" can be flipped back to verified by a later gateway event and vice versa. "Verify" also shows for unsubmitted providers (`people.tsx:85`), and there is no test for `admin_set_provider_kyc`. | Split platform approval (`admin_review_status`) from payout KYC (`kyc_status`). `_provider_is_live` should need both. The server should reject approval when `submitted_at is null` or no payout account exists. Fix the misleading confirm copy. |
| WS7-04 | Sports venue owners cannot see their payouts at all | Technical defect | P1 | before accepting real payments | Sports payouts are inserted with `provider_id = null, payee_id = owner` (`0058:1661-1665`). RLS allows `payee_id` (`0058:247-249`), but `listMyPayouts` filters `.eq('provider_id', uid)` (`supabaseApi.ts:744-748`). Earnings rows also link to `/booking/<booking_id>`, which is null for sports (`earnings.tsx:296`). | Query `or(provider_id.eq.uid,payee_id.eq.uid)` and route sports rows to `/sports-booking/<sports_booking_id>`. Add a venue earnings entry point from `sports/manage.tsx`. |
| WS7-05 | Failed payouts show "Retrying" and count as "Pending payout", but nothing retries them and admins have no UI to retry | Business logic | P1 | before accepting real payments | `statusText.failed = ['Retrying','danger']` (`earnings.tsx:32`). `pending` includes `failed` (`:126`). The `0001:1702` comment says failed payouts are "flagged for an admin, who can call retry_payout()". `retry_payout` is service-role only (`0001:2036/2057`), has no admin UI and no audit. | Label it "Payment problem – our team is checking". Add an admin "Failed payouts" queue with an audited `admin_retry_payout` RPC. Notify the provider. |
| WS7-06 | Admin cannot investigate money: booking detail lacks refunds, payouts, transfers, reversals, receivables, actor and failure reasons | UX / Technical defect | P1 | before accepting real payments | `admin_get_booking` returns only booking, category, customer, provider, address, events (without `actor_id`) and payments (`0041:378-410`). No screen shows the `refunds`, `payouts`, `payout_transfers` (`last_error`), `payout_transfer_reversals` or `provider_receivables` tables (`0001:218-266`, `0011:75`, `0021:637`). A failed load leaves a permanent skeleton (`admin/booking/[id].tsx:18-21`). | Extend `admin_get_booking` with those collections, plus event `actor_id`/role and `last_error`. Render them as sections. Show an error state on failure. |
| WS7-07 | Admin document-review queue exists server-side but has no UI; categories that require documents can never go live | Technical defect | P1 | before pilot (if any category sets `requires_docs`) | `admin_list_document_queue` and `admin_review_document` (`0009:1132-1187`, tested) are not called anywhere in `app/` (the search found no match). `_category_docs_ok` blocks go-live until a document is `approved` (`0009:257-275`). Admins can set `requires_docs` via `admin_upsert_category` (`0056:464-468`). | Add `admin/documents.tsx`: queue, signed-URL preview, Approve with expiry, Reject with a required reason. |
| WS7-08 | No provider is notified about money or account events | Business logic | P1 | before accepting real payments | The booking trigger covers only requested, accepted, declined, expired, cancelled, en_route, quote_sent and completion_requested (`0007:338-381`). Nothing for: quote approved or paid, `completed`, `disputed` (payout frozen, `0021:1001-1012`), dispute resolved (`0021:1059/1077`), payout transferred or failed, KYC or document decisions (`_log_onboarding_event` TODO, `0009 ~300-306`), or suspension. | Add kinds `quote_approved`, `job_completed_payout_scheduled`, `payout_sent`, `payout_problem`, `dispute_opened`, `dispute_resolved`, `verification_update` and `account_suspended`. Text is under Notification audit. |
| WS7-09 | Sports raw notification inserts have no ON CONFLICT and no exception guard inside payment-recording transactions | Technical defect | P2 | before accepting real payments | `record_sports_payment_paid` inserts directly (`0058:1484-1509`), as do `book_sports_slot` (`:1182-1197`), `decide_sports_booking` (`:1262`) and `cancel_sports_booking` (`:1600-1613`). The partial unique index `notifications_pending_collapse_idx (user_id, collapse_key) where status='pending'` (`0007:213-214`) means a still-pending row with the same key raises 23505 and rolls back the payment-recording call. Current key reuse appears unreachable, but the pattern is fragile. | Route all of these through `_queue_notification` (which merges on conflict) inside `begin … exception when others then raise warning … end`. Add a SQL test that pre-inserts a pending row with the same key and still records the payment. |
| WS7-10 | Adding staff requires a raw UUID that no screen shows | UX | P1 | before pilot (merchant staff) | `merchant-staff.tsx:89` "Enter their QuickServe user ID. This does not send an email, text, or invitation link."; `:95-104` "User UUID". `merchant-work.tsx:34` "Ask a business owner to add your existing QuickServe user ID." A search for "user ID" or "Copy ID" finds no screen that displays one. | Add staff by phone number (server looks up the profile) or with a share-code invite. Notify the added member. |
| WS7-11 | Provider, merchant and admin screens and all notifications are English-only | Unvalidated business assumption | P2 | before pilot (Telugu-first areas) | `useT(` is used only in `(auth)/login.tsx`, `location.tsx` and `AccountScreen.tsx`. Notification text is hard-coded English SQL (for example `0007:340-376`). `preferred_language` is never read (only `0045` matches). | Translate the dashboard, earnings and job screens first, and render notification title and body from a key-to-template table by `profiles.preferred_language`. |
| WS7-12 | The dashboard "Today" figure is payouts *created* today, including frozen ones; "Earned this week" includes frozen (disputed) amounts | UX / Business logic | P2 | before pilot | `dashboard.tsx:250` `today = payouts.filter(created today && status!=='reversed')`. `earnings.tsx:99` `earned = status !== 'reversed'`, so frozen counts. | Rename to "Earned today (paid after 24 h)". Exclude `frozen` or show it separately as "On hold – dispute". |
| WS7-13 | Hard-coded payout-timing copy can contradict server rules | Business logic | P3 | later | `earnings.tsx:` "Payouts are released 24 hours after the customer confirms completion." The sports release delay is admin-configurable (`rules.tsx:133`, `_create_sports_payout` uses `release_after_hours`, `0058:1650-1652`). Disputes extend the release. | Show each payout's `release_after` (already done per row) and drop the global sentence, or read it from config. |
| WS7-14 | Dispute UI hides partial refund and provider evidence; the dispute reason appears only as a timeline note | UX | P2 | before accepting real payments | `admin/booking/[id].tsx:24-36, 65-69` offers only `denied` and `full_refund`. The enum has `partial_refund` (`create type public.dispute_outcome`). Notes are fixed strings ("Full refund by admin support"). | Add a partial-refund amount input (≤ paid), a required admin note, and the dispute reason as a header. |
| WS7-15 | Provider cannot respond to reviews or raise a dispute | Business logic | P2 | before scaling | `reviews.provider_reply` has no writer. `dispute_booking` is customer-only (`0021:997`). | Add `reply_to_review(p_review_id, p_text)` (one reply, provider-owned, masked) and a provider "Report a problem" that opens a support thread linked to the booking. |
| WS7-16 | Push is unlikely to work in production builds as configured | Unvalidated business assumption | P1 | before pilot | `app/app.json` lacks `extra.eas.projectId`, so `registerForPush` returns `'unavailable'` (`push.ts:88-89`). No `googleServicesFile` (FCM). `pushAvailable` is false on web and in demo (`push.ts:18`), so E2E never exercised push. | Configure EAS projectId and FCM/APNs. Run a real-device test of accept/decline pushes on Android. |
| WS7-17 | SMS OTP provider not configured in the repo | Unvalidated business assumption | P0 | before pilot | `supabase/config.toml:9-10`. Docs require MSG91/Twilio plus DLT registration (`docs/04…:10, 192`). Without it nobody can log in outside test numbers. | Register DLT templates, configure the Supabase phone provider, and verify OTP delivery on Jio, Airtel and Vi. |
| WS7-18 | Admin "Reject" gives the provider no actionable reason; there is no "needs clarification" action | UX | P2 | before pilot | `people.tsx:48` hard-codes "Rejected after admin review". The RPC supports `needs_clarification` (`0041:327`), but the UI does not expose it. `admin_set_provider_review_note` (`0009:1189`) has no UI. | Require a free-text reason and offer "Ask for changes" (`needs_clarification` + review note). |
| WS7-19 | No admin view for sports bookings/payments, customers, review moderation, notification failures or the audit log | Business logic | P2 | before accepting real payments (sports payments); later (others) | See F33, F44, F45, F51, F52. | Add read-only admin lists first (sports bookings with payments/refunds; audit log by target). |
| WS7-20 | Staff and managers never receive notifications for business work | Business logic | P2 | before scaling | Every booking notification targets `b.provider_id` (the owner), for example `0007:338-376`. There is no fan-out to `business_members`. | Fan out `booking_requested`, `chat_message` and `quote_*` to active managers (and staff for chat), behind the existing `merchant_staff` flag. |
| WS7-21 | Notification history is deleted after 30 days even if unread | Business logic | P3 | later | `resolve_push_receipts` deletes `sent/skipped/failed` rows older than 30 days (`0007:536`). | Keep unread rows, or extend retention to 90 days. |
| WS7-22 | Admin dashboard labels GMV as "Revenue" | UX | P3 | later | `admin/index.tsx:33` "Revenue" = `gmv_period_paise`. | Rename to "Customer payments (GMV)" and add "Platform commission". |
| WS7-23 | Sports venue setup needs technical input (lat/lng, HTTPS photo URLs) | UX | P2 | before pilot (sports) | `sports/manage.tsx:446-450`. | Reuse the `AreaSection` place search and the media picker from `PortfolioSection`. |
| WS7-24 | Bill-photo rule for parts over ₹500 is client-only | Business logic | P2 | before accepting real payments | `quote/[bookingId].tsx:414`. `send_quote` inserts `bill_photo_url` without any check (`0052:925-1000`). | Assert server-side: `kind='part' and qty*unit_price > 50000` ⇒ `bill_photo_url` is required. |
| WS7-25 | Staff dashboard shows raw status codes | UX | P3 | before pilot | `dashboard.tsx:238` `{job.status} · …` (for example "in_progress"). | Use `StatusPill` or a mapped label as in the owner view. |

## Provider dashboard comprehension

**`(provider)/dashboard.tsx` (owner view).** The screen runs top to bottom in this order:

1. Date and "Hi {name}".
2. Bell, labelled "Notifications, N unread".
3. Online card: "Online. Turn off to stop receiving requests" / "Offline. Turn on to receive requests".
4. "Manage business staff".
5. Go-live card (`GoLiveStatusCard`) or "Not visible in search yet" with "Finish your provider profile and payout setup to go live."
6. Stats strip: **"Today"** (₹), **"Rating"**, **"Acceptance"**, **"Completion"**.
7. Travel-request inbox, recurring overview and proposal inbox.
8. **"New requests"** with the subtitle "Accept within 15 minutes or the request expires", using Accept/Decline.
9. **"Next job"**.
10. **"Other active jobs" / "Active jobs"** with "All jobs". Each row shows "Next: Start trip | Enter start code | Send quote | Awaiting approval | Awaiting payment | Mark complete | Enter completion code | On hold · view".

| Question | Shown? | Evidence / comment |
|---|---|---|
| Today's work | Partly | No "Today" job list. "Next job" is the highest-priority active status, not the next by time (`ACTIVE_PRIORITY` sort, `dashboard.tsx:224-233`). |
| Pending requests | Yes | "New requests". However, requests are split across four stacked widgets (travel, recurring, proposal, booking requests) before it. |
| Upcoming bookings | No (mixed in) | Future accepted jobs sit inside "Active jobs" with no date heading. |
| Active projects | Partly | The proposal inbox and recurring overview are separate cards. |
| Outstanding payments (customer owes) | Weak | Only the row label "Awaiting payment". No amount and no total. |
| Completed work | Not on dashboard | Only `jobs.tsx` "Job history" with the "Closed" filter. |
| Earnings | Misleading | "Today" = payouts created today, frozen ones included (WS7-12). |
| Required actions | Partly | Go-live reasons, plus per-job "Next:". There is no single "To do" list, and nothing for disputes or payout problems. |

**`(provider)/earnings.tsx`.**

- Labels: "This week / Last 4 weeks", "Earned this week", **"Pending payout"**, **"Paid to bank"**, "Payout account: Linked · verified / Verification failed / Verification pending", "Next payout", and per-row "Billed ₹X · Fees − ₹Y · Net ₹Z", "Releases …", "Paid …".
- Clear for a plumber.
- Problems:
  - "Retrying" is misleading (WS7-05).
  - Frozen payouts are included in "Earned".
  - Receivables are missing.
  - Sports venue owners see nothing (WS7-04).
  - The "Payout account" line requires `razorpay_account_id`, so a provider on the RazorpayX fund-account rail (`provider_payout_accounts.fund_account_id`) shows "Verification pending" even when payable (`earnings.tsx:245-252` vs `sync_provider_payout_status` `0058:191-193`). This is UNTESTED and needs verification.

**`(provider)/business-tools.tsx`.**

- Labels: "Bring an existing client on-platform", "3% tools fee · no provider commission", "Create secure invite", "The secure token expires in 7 days. It cannot be recovered here after you leave this screen."
- Understandable, but it uses the old brand "QuickServe" (`:71-72`).

**`jobs.tsx`.** "Job history", filters "All / Active / Closed", empty state "Stay online to receive requests from customers nearby." Acceptable.

**`merchant-*` screens.**

- `merchant-enquiries.tsx`: "Shop enquiries — Customer conversations about your catalogue". Clear.
- `merchant-rfqs.tsx`: "Supplier RFQs — Requests routed to your verified shop", rows "… item(s) · … · Needed by …", badge "Quote sent". "RFQ" is jargon for a shop owner.
- `merchant-work.tsx`: "Open assigned jobs / Open shop enquiries / Open supplier RFQs / Open sports bookings". This is a menu, not a work view.
- `merchant-staff.tsx`: UUID entry (WS7-10).
- `merchant-calendar.tsx`: "Recurring calendar — Provider visits by day or week". Fine.

**Recommended simplified layout for the owner dashboard, in English (Telugu to follow).** Top to bottom:

1. Online switch: "You are ON – customers can book you" / "You are OFF".
2. A **"Needs your reply (n)"** card that merges booking, travel, recurring and proposal requests, each with a countdown and "Accept" / "Say no" buttons.
3. **"Today (n jobs)"**: a time-ordered list with one big button per job: "Start going", "Enter customer's code", "Send bill", "Finish job".
4. **"Coming up"**: grouped by date.
5. **"Waiting for customer"**: approve bill / pay, showing the amount.
6. **"Money"**: "To bank soon ₹X (date)", "Sent to bank this week ₹Y", "Problem with payment ₹Z – we're fixing it".
7. **"Finished jobs"**: a link to history.

Rename "Acceptance" and "Completion" to "Jobs you accepted" and "Jobs you finished", and move them below the work lists.

## Admin investigation capability

**Scenario: failed booking or disputed payment.**

| Need | Available? | Evidence |
|---|---|---|
| What happened and when | Partial | `admin_get_booking.events` gives `at`, `from`, `to` and `note` (`0041:395-396`), rendered as "Timeline" (`admin/booking/[id].tsx:58-62`). |
| Which user or provider acted | No | `booking_events.actor_id` exists (`0001:477`) but is not returned. Only customer and provider name and phone are shown. |
| Amount | Yes | Booking total (`PriceRow`) plus each payment's purpose, status and amount. |
| Which backend operation failed | No | `payout_transfers.last_error`, `refunds` status and reversal status are not returned. Notification `last_error` is not exposed. Webhook failures are not stored for admin. |
| Refund or settlement pending? | No | Refunds and payouts are absent from the RPC and the UI (WS7-06). |
| Gateway ids for Razorpay lookup | Partial | `payments.gateway_id` is returned but **not rendered**. |
| Sports bookings / RFQ orders | No / read-only | No admin sports-booking view. RFQs are only on the `admin_rfq_dashboard` view. |

**Admin actions, role checks and audit** (latest definitions; all guarded by `_assert(_is_admin())` server-side):

| Action | RPC (file:line) | Audited in `admin_audit_log` | UI |
|---|---|---|---|
| Verify / reject provider | `admin_set_provider_kyc` (0041:319) | Yes | `people.tsx` |
| Suspend / restore | `set_provider_suspended` (0001:1412) | Yes | `people.tsx` |
| Review document | `admin_review_document` (0009:1151) | Yes | **none** |
| Review note | `admin_set_provider_review_note` (0009:1189) | Yes | **none** |
| Review provider link | `admin_review_provider_link` (0012:239) | Yes | (not found in app) |
| Resolve dispute | `resolve_dispute` (0021:1016) | Yes | `admin/booking/[id].tsx` |
| Payout rail | `admin_set_payout_rail` (0011:29) | Yes | none |
| Add receivable | `admin_add_provider_receivable` (0011:105) | Yes | none |
| Retry payout | `retry_payout` (0011:287) | **No** (service-role only) | none |
| Commission | `admin_set_commission`, `admin_set_category_commission` (0043) | Yes | `commission.tsx` |
| Features | `admin_set_feature` (0042:55) | Yes | `features.tsx` |
| Rules | `admin_set_rules` (0054:92) | Yes | `rules.tsx` |
| Coins | `admin_set_coins_config`, `admin_adjust_coins` (0047) | Yes | `coins.tsx` |
| Geography | `admin_upsert_geo` (0046:91) | Yes | `geography.tsx` |
| Categories | `admin_upsert_category`, `admin_set_category_active`, `admin_reorder_categories`, `admin_set_category_city` | Yes | `services.tsx`, `category/[id].tsx` |
| Shops / product categories | `admin_set_shop_status`, `admin_set_product_category_active` | Yes | `shops.tsx` |
| Sports venues / activities | `admin_set_venue_status`, `admin_set_sports_activity` | Yes | `sports.tsx` |
| Support reply / status | `support_send`, `support_set_status` (0041:524/561) | No (messages persist; status changes do not) | `support/*` |

Read-only admin RPCs (`admin_dashboard`, `admin_list_*`, `admin_get_booking`, `admin_*_dashboard`) are guarded and not audited. That is acceptable, except that reading customer phone numbers is not logged. Logging PII access may matter later for privacy, but it is not a pilot blocker.

**Verdict.** Server-side role enforcement is consistent and tested on key paths ("non-admin cannot resolve", "only admins review documents", "only admins switch rails"). The audit trail is written but unreadable. Investigation capability is **insufficient for real payments**: an admin cannot see refund or payout state, transfer errors, or who did what. Any failed payout or refund requires direct DB access.

## Notification audit

Columns:

- **Deep link**: the target `notificationRoute()` resolves; ✓ means the route file exists under `app/app`.
- **Dup risk**: the collapse key, or "—" when there is none.
- **In-app**: every row is listed by `list_my_notifications` (0032:24-38), including rows skipped for having no device (yes for all), until the 30-day purge.

| Kind | Trigger (file:line) | Recipient | Message (quoted) | Deep link | Dup risk | Verdict + improved wording |
|---|---|---|---|---|---|---|
| chat_message | `_on_message_inserted` (0010:34) | Other participant, unless viewing | Title "{FirstName}" → push "New message from {name}" / "{n} new messages from {name}" (logic.ts:57-60); body masked preview or "Sent a photo" | `/chat/{booking}` ✓ | `chat:{booking}`, merged while pending; skipped once read | Good. Telugu needed. |
| request_message | `send_request_message` (0052:1256) | Other side of the request | "New request message" / masked body | `/proposal/compose/{req}` (provider) or `/request/{req}` ✓ | `request-message:{req}:{provider}` | OK → "Message from {name} about your request". |
| booking_requested | trigger (0007:340-343) | Provider | "New job request" / "{Category} · {City} · accept within 15 minutes" | `/booking/{id}` ✓ (SQL-tested) | — (one per event) | Good → "New job: {Category} in {Area}. Reply within 15 min or it goes to another pro." |
| booking_accepted | 0007:344-347 | Customer | "Booking accepted" / "{Pro} accepted your {cat} booking." | `/booking/{id}` ✓ | — | Good. |
| booking_declined | 0007:348-351 | Customer | "Booking declined" / "{Pro} could not take this job. Your visit fee is being refunded." | ✓ | — | Good. |
| booking_expired | 0007:352-355 | Customer | "Request expired" / "The pro did not respond in time. Your visit fee is being refunded." | ✓ | — | Good. **Provider gets nothing** → add "You missed a job request ({cat}). Stay online and reply within 15 min." |
| booking_cancelled | 0007:356-361 | Provider only | "Booking cancelled" / "The customer cancelled the {cat} booking." | ✓ | — | **FAIL (WS7-01).** The customer is never told about a provider or system cancellation. |
| provider_en_route | 0007:362-365 | Customer | "{Pro} is on the way" / "Share your start code when they arrive." | ✓ | — | Good. |
| quote_sent / change_order_sent | 0007:366-375 | Customer | "Quote received" / "{Pro} sent a quote. Review and approve it to start the work."; "Change order received"; "Updated quote received" | ✓ | — | Good. No mirror to the provider on approve/reject (WS7-08). |
| completion_requested | 0007:376-379 | Customer | "Job marked complete" / "{Pro} finished the work. Check it and confirm completion." | ✓ | — | Good. |
| (missing) completed / payout / dispute / KYC | — | Provider | — | — | — | **NOT IMPLEMENTED (WS7-08).** Proposed: "Job finished – ₹X will reach your bank on {date}"; "₹X sent to your bank"; "Problem sending ₹X – our team is fixing it"; "Customer raised a problem with job #{ref}. Payment is on hold."; "Problem resolved: {outcome}"; "Your profile is approved – you can now get jobs" / "Please fix: {reason}". |
| travel_request_created | 0014:276 | Provider | "Travel request" / "{Name} asked you to travel {d} km for ₹{fee}." | `/dashboard` ✓ | `travel-request:{id}` | OK → add "Reply before {time}". |
| travel_request_approved / declined | 0014:325 | Customer | "Travel request approved"…; declined: "The provider could not travel for this slot. {reason}" | No `url` in payload (data not shown in full); a `provider_service_id` key alone has no rule → likely no route | `travel-request…` | PARTIAL: add `url: /book/{ps}`. UNTESTED. |
| travel_request_expired | 0014:407 | Customer | "Travel request expired" / "The provider travel approval expired. Choose a slot again…" | `/book/{ps}` ✓ | ✓ | OK. |
| proposal_request_received | `_proposal_notice` (0040:471) | Matched providers | "New proposal request" / "Urgent proposal request"; "{Area} · {DD Mon[, time]} · reply fast" | `/proposal/compose/{req}` ✓ | `proposal-request:{req}` (raw insert, one per provider) | OK. |
| proposal_received | 0052:1199 | Customer | "New proposal received" / "A verified provider sent a proposal for your request." | `/request/{req}` ✓ | `proposal-received:{req}` (merged) | OK. |
| proposal_booked | 0029:256-261 | Both | "Booking confirmed" / "Your advance is paid…"; provider: "You have a confirmed booking" / "The customer paid the booking advance." | `/booking/{id}` ✓ | `proposal-booked:{id}` | Good. |
| proposal_hold_expired | 0030:378 | Customer | "Proposal hold expired" / "The payment window closed. Your request is available again." | `/booking/{id}` ✓ | ✓ | OK. |
| milestone_due | 0023:1285 | Customer | "Payment milestone due" / "{label} is ready to pay in QuickServe." | ✓ | `milestone:{id}` | Brand → "Nearo". |
| delivery_submitted | 0044:136 | Customer | "Your deliverables are ready" / "Review the delivery and pay any final milestone…" | ✓ | ✓ | OK. |
| revision_requested | 0044:89 | Provider | "Revision requested" / "The customer requested changes: {note}" | ✓ | key present | Note is not masked → apply `_mask_preview`. |
| support_reply | `_support_post` (0041:479) | User | "QuickServe support replied" / body | `/support/{id}` ✓ | `support:{id}` | Brand. |
| support_message | 0041:485 | All admins | "Support: {name} · {subject}" | `/admin/support/{id}` ✓ | `support-admin:{id}` | OK. |
| product_enquiry / _reply | 0049:946-953 | Shop owner / customer | "New product enquiry" / "Customer replied"; "{Shop} replied about a product" | `/enquiry/{id}` ✓ (SQL-tested) | ✓ | Body unmasked (`left(v_body,300)`) → mask. |
| rfq_received | 0050:301 | Shop owners | "New product RFQ" / "A customer requested a quotation for {title}" | `/rfq/merchant/{id}` ✓ | `rfq:{id}` | → "New price request: {title}". |
| rfq_quote_received | 0052:915 | Customer | "A shop sent a quotation" / "{Shop} replied to your product RFQ" | `/rfq/{id}` ✓ | ✓ | Avoid "RFQ". |
| recurring_plan_requested | 0057:1090 | Provider | "Recurring plan request" / "A customer requested a recurring service plan." | **None** (WS7-02) | ✓ | FAIL. Add a url; → "{Name} wants {service} every {freq}. Reply to accept." |
| recurring_plan_accepted / declined | 0057:1131/1143 | Customer | "Recurring plan accepted" / "The provider accepted your recurring plan."; declined: {reason} | **None** | ✓ | FAIL (route). |
| recurring_plan_paused / resumed / cancelled | 0057:1242/1274/1409 | Provider | "Recurring plan paused" / "The customer paused a recurring service plan." etc. | **None** | ✓ | FAIL (route). |
| recurring_visit_skipped | 0057:1328 | Provider | "Recurring visit skipped" | `/booking/{id}` (booking_id set) ✓ | ✓ | OK. |
| recurring_visit_unavailable | 0057:1482 / 2280-2286 | Customer / provider | "Recurring visit unavailable"; "Recurring visit expired" / "The payment window for this recurring visit expired…" | 1482: **None**; 2280: booking ✓ | ✓ | PARTIAL. |
| recurring_visit_reschedule_* | 0057:1821/1903 | Other party | "Visit reschedule requested" / {reason}; "Visit rescheduled"; "Reschedule declined" | `/booking/{id}` ✓ | ✓ | OK. |
| recurring_visit_cancelled_by_provider | 0057:1945 | Customer | "Provider unavailable" / {reason} | ✓ | ✓ | OK. |
| recurring_visit_upcoming | `queue_recurring_reminders` (0057:2163) | Customer | "Upcoming recurring visit" / "You have an upcoming home-service visit." | booking ✓ | collapse | Flag `recurring_reminders` default off (doc 12:87). There is no provider reminder for any upcoming job. |
| sports_booking_requested | 0058:962/1182 | Venue owner | "New sports venue request" / "{Venue} has a new booking request." | `/sports-booking/{id}` ✓ (owner view supported, `sports-booking/[id].tsx:61`) | ✓ (raw insert, WS7-09) | E2E `phase-6-sports-booking-request` FAILED. → add slot time. |
| sports_booking_confirmed | 0058:1190 / 1484 | Customer + owner | "Sports booking confirmed" / "{Venue} booking confirmed." / "{Venue} has a paid booking." | ✓ | ✓ | Add date/time. |
| sports_payment_due / _accepted / _declined | `decide_sports_booking` (0058:1262) | Customer | "Payment due for sports booking" / "{Venue} approved your booking. Complete payment before the deadline." | ✓ | ✓ | Include the deadline time. |
| sports_booking_cancelled / _expired / sports_refund_issued | 0058:1381/1501/1600-1607/1739 | Customer or owner | "Sports refund queued" / "A refund has been queued according to the sports cancellation policy."; "Sports booking expired" | ✓ | ✓ | Add the amount. |

**Push transport.**

- Outbox → `send-notifications` (Expo, batches of 100, retry backoff of 1/2/4/8 min then `failed`, receipts, dead-token cleanup; `index.ts`, `logic.ts`, `0007:441-516`). Server path is PASS (SQL).
- Kicked by `pg_net` on insert (`0007:403-437`), with a cron safety net documented in README l.107/134.
- Android channels: "Chat messages" and "Booking updates" (`push.ts:38-40`).
- Real-device delivery is unproven (WS7-16).

**`schedule-reminders`.** Despite its name, it only runs `process_proposal_milestones` and `expire_proposal_flows` (`schedule-reminders/index.ts:10-13`). There are no job reminders for providers.

**SMS/OTP.** Supabase phone auth with no provider configured (WS7-17).

**Email.** None.

## Remediation tasks

| ID | Objective | Files (exact paths) | Required change | Depends on | Acceptance criteria | Tests to add | Complexity | Parallelisable |
|---|---|---|---|---|---|---|---|---|
| WS7-T01 | Notify the right party on cancellation | `supabase/migrations/0059_ws7_notifications.sql` (new) | Copy the latest `_on_booking_event_notify` from `0007_chat_unread_notifications.sql:322-394` into the new migration. Replace the `cancelled` branch: `select actor_id`-based logic. If `new.actor_id = b.customer_id` → `v_to := b.provider_id`, body "The customer cancelled the {cat} booking.". Else if `new.actor_id = b.provider_id` → `v_to := b.customer_id`, title "Booking cancelled by your pro", body "{Pro} cancelled your {cat} booking. Any refund due is on its way.". Else (null actor) → queue two notifications (customer and provider) with "This {cat} booking was cancelled." Keep the exception guard. | — | A provider cancellation queues one `booking_cancelled` row for the customer, a customer cancellation one for the provider, and a system cancellation two. | SQL in `supabase/tests/cancellation_payouts.test.mjs`: three cases asserting the `user_id` and body. | S | Yes |
| WS7-T02 | Fix recurring deep links | `supabase/migrations/0059_ws7_notifications.sql`, `app/src/lib/unread.ts`, `app/src/lib/__tests__/unread.test.ts` | (a) SQL: re-create every function in `0057_recurring_plans_v2.sql` that queues `recurring_*` without a booking (lines 1090, 1131, 1143, 1242, 1274, 1409, 1482) so the `data` jsonb also contains `'url', '/recurring/provider/' \|\| r.id` when the recipient is the provider and `'/recurring/' \|\| r.id` when it is the customer. Use the latest bodies verbatim and change only `jsonb_build_object`. (b) `unread.ts:109`: `const plan = [d.plan_id, d.recurring_schedule_id].find((x) => typeof x === 'string' && ID.test(x))`. (c) Extend `SAFE_ROUTE` to allow `recurring/provider/<id>`: add `SAFE_RECURRING_PROVIDER = /^\/recurring\/provider\/[A-Za-z0-9-]{1,64}$/` and test it like `SAFE_MERCHANT_RFQ_ROUTE`. | — | A tap on any recurring notification opens the correct screen for its role. | Jest: `notificationRoute({recurring_schedule_id:'p1'}, 'recurring_plan_accepted')` → `/recurring/p1`; `{url:'/recurring/provider/p1'}` → same. SQL: `recurring_plans.test.mjs` asserts `data->>'url'` for `recurring_plan_requested`. | M | Yes (the SQL part shares the migration with T01; coordinate) |
| WS7-T03 | Separate admin approval from payout KYC | `supabase/migrations/0060_ws7_provider_approval.sql`, `app/app/admin/people.tsx`, `app/src/lib/adminApi.ts` | Add `providers.admin_review_status text not null default 'pending' check in ('pending','approved','rejected','needs_clarification')` and backfill `approved` where `kyc_status='verified'`. New `admin_set_provider_review(p_provider_id, p_status, p_reason)` that asserts `_is_admin()`, `submitted_at is not null`, and a reason when not approved, then writes `admin_audit_log`. Re-create `_provider_is_live` (latest def `0009:281`) adding `and p.admin_review_status = 'approved'`. Keep `kyc_status` for the gateway only. UI: call the new RPC. Change the confirm text to "They will appear in search once their payout account is verified." Add a reason `Input` for Reject / Ask for changes. | — | Admin approval no longer changes `kyc_status`. A gateway event cannot undo an admin rejection. An unsubmitted provider cannot be approved. | SQL `provider_onboarding.test.mjs`: non-admin rejected; unsubmitted rejected; approved + KYC pending ⇒ not live; gateway `activated` after admin reject ⇒ still not live. | M | Yes |
| WS7-T04 | Admin document review screen | `app/app/admin/documents.tsx` (new), `app/src/lib/adminApi.ts`, `app/app/admin/index.tsx` | Add `listDocumentQueue()` → `rpc('admin_list_document_queue')` and `reviewDocument(id, approve, reason, expiresOn)` → `rpc('admin_review_document', …)`. The screen lists documents with provider name, doc type and created date. "View" uses `supabase.storage.from('provider-docs').createSignedUrl(file_path, 300)`. "Approve" asks for an expiry date when needed; "Reject" requires a reason of 5+ characters. Add an `Action label="Documents"` card on the admin index. | — | An admin can approve or reject a pending document. The provider's go-live state updates. | E2E step `admin-document-review` (demo). Jest for the adminApi wrappers (note: Jest is not in CI; add it to CI or keep as SQL). | M | Yes |
| WS7-T05 | Show venue payouts and fix failed-payout copy | `app/src/lib/supabaseApi.ts`, `app/src/lib/demo/demoApi.ts`, `app/app/(provider)/earnings.tsx`, `app/src/lib/types.ts` | `listMyPayouts`: `.or(\`provider_id.eq.${uid},payee_id.eq.${uid}\`)`. Add `sports_booking_id: string \| null` to `Payout`. Row press: `p.sports_booking_id ? '/sports-booking/[id]' : '/booking/[id]'`. `statusText.failed = ['Payment problem','danger']`. Exclude `frozen` from `earned` (`earnings.tsx:99`) and show it as a separate MiniStat "On hold (dispute)". Remove the hard-coded "24 hours" sentence (keep the commission text). | — | A venue owner sees sports payouts. Failed payouts read "Payment problem". | SQL `sports_payments.test.mjs`: the owner can `select` their payout via RLS. E2E `earnings` (demo) asserts "Payment problem" for a seeded failed payout. | S | Yes |
| WS7-T06 | Admin money visibility and actions | `supabase/migrations/0061_ws7_admin_money.sql`, `app/app/admin/booking/[id].tsx`, `app/app/admin/payouts.tsx` (new), `app/src/lib/adminApi.ts` | Re-create `admin_get_booking` (latest `0041:378`) adding `'events'` with `actor_id` and actor role (`customer`/`provider`/`admin`/`system`), and arrays `refunds` (`id`, `amount`, `status`, `attempts`, `last_error`, `created_at`), `payouts` (`id`, `gross`, `commission`, `amount`, `status`, `release_after`, `transferred_at`), `transfers` (`status`, `last_error`, `attempts`), `reversals` and `receivables`. New `admin_list_problem_payouts()` (payouts `status='failed'` or transfers with `last_error`) and `admin_retry_payout(p_payout_id, p_note)`. That RPC asserts `_is_admin()`, performs `retry_payout`'s updates (copy from `0011:287-302`) and inserts `admin_audit_log` action `retry_payout`. UI: render the new sections; error state on load failure; partial-refund input (integer rupees → paise, ≤ paid) calling `resolve_dispute(id,'partial_refund',amount,note)` with a required note. | T05 | An admin sees refund and payout state and errors for any booking and can retry a failed payout (audited). | SQL `cancellation_payouts.test.mjs`: non-admin rejected for both new RPCs; retry writes the audit row and moves the transfer to `pending`. | L | Partly (UI after SQL) |
| WS7-T07 | Provider money and account notifications | `supabase/migrations/0059_ws7_notifications.sql` | Extend `notifications_kind_check` using the dynamic pattern in `0054_addendum_foundations.sql:268-300` with `quote_approved`, `job_completed_payout_scheduled`, `payout_sent`, `payout_problem`, `dispute_opened`, `dispute_resolved`, `verification_update` and `account_suspended`. In `_on_booking_event_notify` add branches: `to_status='in_progress' and from_status in ('quote_sent','awaiting_payment')` → provider "Customer approved your bill – start the work"; `to_status='completed'` → provider "Job finished – payment on {release date}"; `to_status='disputed'` → provider "Customer reported a problem. Payment for this job is on hold."; `from_status='disputed'` → both parties with the outcome. Add `perform _queue_notification` inside `complete_transfer` (`0001:1672`), the payout failure path, `admin_review_document`, the approval RPC from T03 and `set_provider_suspended`. Re-create from the latest defs and wrap each in `begin … exception when others then raise warning … end`. | T01, T03 | Each event queues exactly one row for the provider, deep-linked to `/booking/{id}` or `/earnings`. | SQL per kind in `cancellation_payouts.test.mjs` and `provider_onboarding.test.mjs`. | L | No (same migration as T01/T02) |
| WS7-T08 | Harden sports notification inserts | `supabase/migrations/0062_ws7_sports_notify.sql` | Re-create `book_sports_slot`, `decide_sports_booking`, `record_sports_payment_paid`, `_refund_unmatched_sports_capture`, `cancel_sports_booking`, `expire_sports_requests` and `request_sports_slot` from their latest bodies in `0058_sports_payments.sql`. Replace each `insert into public.notifications (…) values (…)` with `perform public._queue_notification(user, kind, null, title, body, data, key)` wrapped in `begin … exception when others then raise warning 'sports notification skipped: %', sqlerrm; end;`. | — | Payment recording succeeds even when a pending notification with the same key exists. | SQL `sports_payments.test.mjs`: pre-insert a pending `sports-booking-confirmed:{id}` row, then call `record_sports_payment_paid` → `ok:true` and the booking is `accepted`. | M | Yes |
| WS7-T09 | Staff by phone number | `supabase/migrations/0063_ws7_staff_by_phone.sql`, `app/app/merchant-staff.tsx`, `app/app/merchant-work.tsx` | New `add_business_member_by_phone(p_owner_id, p_phone text, p_role text)`: normalise to E.164, look up `auth.users.phone`, raise 'no Nearo account with this number' if none, then call `add_business_member`. Notify the member (`business_access_added`). UI: replace the "User UUID" input with a phone input (reuse `normalizeIndianPhone` from `app/src/lib/phone.ts`). Change `merchant-work.tsx:34` copy to "Ask the business owner to add your phone number." | — | An owner adds staff by phone. The member is notified. | SQL `merchant_staff.test.mjs`: unknown phone rejected; a non-owner cannot add; flag off rejects. | M | Yes |
| WS7-T10 | Server-side bill-photo rule | `supabase/migrations/0064_ws7_quote_bill.sql` | Re-create `send_quote` (latest `0052_merchant_staff.sql:925`) adding, inside the item loop: `perform _assert(v_kind <> 'part' or v_qty*v_price <= 50000 or nullif(v_item->>'bill_photo_url','') is not null, 'parts above ₹500 need a bill photo');`. | — | A quote with a ₹600 part and no photo is rejected. | SQL `booking_core.test.mjs`. | S | Yes |
| WS7-T11 | Provider review reply | `supabase/migrations/0065_ws7_review_reply.sql`, `app/src/components/ProviderMeSections.tsx`, `app/src/lib/supabaseApi.ts`, `app/src/lib/demo/demoApi.ts` | `reply_to_review(p_review_id uuid, p_text text)`: assert the caller is `reviews.provider_id`, `provider_reply is null`, 2–500 characters, and the text is masked through `_mask_preview(p_text, 500)`. Add a "Reply" button under each review. | — | One reply per review, shown publicly. | SQL: non-owner rejected; second reply rejected; contacts masked. | S | Yes |
| WS7-T12 | Dashboard wording and grouping | `app/app/(provider)/dashboard.tsx` | Rename the stat "Today" → "Earned today", computing it from payouts with `status in ('pending','transferred')`. Replace `{job.status}` at l.238 with `<StatusPill status={job.status} />`. Split `active` into `today` (scheduled today, or ASAP) and `upcoming` (later, grouped by date) sections titled "Today" and "Coming up". | — | Labels are visible in the E2E screenshot. | E2E `dashboard-next-job` asserts the "Today" section. | M | Yes |
| WS7-T13 | Telugu for provider surfaces and notifications | `app/src/i18n/en.ts`, `app/src/i18n/te.ts`, provider screens, a new migration | Move dashboard, earnings and jobs strings to i18n keys. Add a table `notification_templates(kind, lang, title, body)` and make `_queue_notification` look up the recipient's `preferred_language` with fallback to `en`. | T07 | A Telugu user receives Telugu push and in-app text. | SQL `preferred_language.test.mjs`. | L | Partly |
| WS7-T14 | Push readiness | `app/app.json`, `app/eas.json` | Add `expo.extra.eas.projectId` and the Android `googleServicesFile`. Document the Vault secrets. | — | A real Android device receives `booking_requested` within 10 s. | Manual real-device checklist (NEEDS REAL USER VALIDATION). | S | Yes |
| WS7-T15 | Admin audit log viewer | `supabase/migrations/0066_ws7_audit_view.sql`, `app/app/admin/audit.tsx` | `admin_list_audit(p_target uuid default null, p_limit int default 100)` guarded by `_is_admin()`, returning `admin name`, `action`, `target_id`, `details` and `created_at`. Add a screen with an optional target filter, linked from the booking and people screens. | — | An admin can see who resolved a dispute. | SQL: non-admin rejected. | S | Yes |

## Regression tests to add

1. **SQL `cancellation_payouts.test.mjs`.**
   - `provider_cancel_booking` queues `booking_cancelled` for the customer (not the provider).
   - A customer cancellation queues for the provider.
   - A system cancellation (actor null) queues for both with neutral text.
2. **SQL `recurring_plans.test.mjs`.** Every `recurring_*` notification has `data->>'url'` matching `^/recurring(/provider)?/<uuid>$`, and provider recipients get `/recurring/provider/`.
3. **Jest `unread.test.ts`** (and add Jest to CI). `notificationRoute({recurring_schedule_id:id}, 'recurring_plan_requested')` resolves. Replace the `plan_id` fixtures that mirror no server payload.
4. **SQL `provider_onboarding.test.mjs`.**
   - `admin_set_provider_kyc` (or its replacement) rejects non-admins.
   - It rejects unsubmitted providers.
   - Approval without a payout account does not make `_provider_is_live` true.
   - A gateway status event does not undo an admin rejection.
5. **SQL `sports_payments.test.mjs`.**
   - A pre-existing pending notification with the same collapse key does not make `record_sports_payment_paid` fail.
   - The venue owner can read their payout row via RLS (`payee_id`).
6. **SQL `cancellation_payouts.test.mjs`.**
   - `admin_get_booking` returns refunds, payouts, transfers with `last_error`, and event `actor_id`.
   - `admin_retry_payout` is admin-only and writes `admin_audit_log`.
   - Partial dispute refund via the UI path amount (≤ paid).
7. **SQL `booking_core.test.mjs`.** `send_quote` rejects a part line over ₹500 without `bill_photo_url`.
8. **SQL `merchant_staff.test.mjs`.**
   - `remove_business_member` is owner-only.
   - `add_business_member_by_phone` rejects unknown numbers and non-owners.
   - The added member receives a notification.
9. **SQL, new notification kinds.** One assertion per kind (`dispute_opened`, `dispute_resolved`, `payout_sent`, `payout_problem`, `verification_update`, `account_suspended`) that exactly one row is queued for the correct recipient with a valid deep link.
10. **E2E `web-smoke.mjs` (demo).**
    - `admin-document-review` (approve with expiry).
    - `earnings-failed-payout-label` ("Payment problem").
    - `merchant-staff-add-by-phone`.
    - `admin-booking-money-sections` (Refunds/Payouts headings visible).
11. **Real-device validation (NEEDS REAL USER VALIDATION).**
    - Android push for `booking_requested` and `chat_message`, while the app is closed and while it is in the foreground.
    - SMS OTP delivery on Jio, Airtel and Vi after DLT.
    - A Telugu-preferring provider completes accept → start → bill → finish → reads earnings without help.
