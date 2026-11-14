# QuickServe — Multi-Category Expansion Plan (all local services)

**Status:** Approved plan, not yet implemented. **Owner:** founder. **Executor:** any model, by following this document literally.
**Goal:** Move QuickServe from "home repairs" to **all common local services**: beauty, wellness, events and weddings, photography, catering, learning, care, auto, pets, moving, business services. It must stay production-grade: no test-data dependence, industry-standard flows, and the existing repair flow must not regress.

Read this whole document before starting any task. Sections 1–6 are the design. Section 7 is the task list. Section 8 holds the rules every task must follow.

---

## 1. The core idea: fulfilment archetypes, not per-category code

Services differ in **how they are priced, paid and delivered**, not in what they are called. Established marketplaces converge on a few booking models:
- **Fixed-price, instant-book packages** (Urban Company salon/cleaning: price shown before booking, pay at booking).
- **Inspect → itemized quote → approve** (Urban Company repairs with a visible rate card; this is QuickServe's current flow).
- **Request-for-proposal with milestone payments** (Thumbtack/Bark-style quotes; Indian wedding vendors use a booking advance, milestones and a final settlement).
- **Time-based or recurring** work (maids, cooks, tutors, caregivers).

QuickServe will support **five archetypes**. Each category is mapped to one archetype through **configuration (data), not code branches**. Adding "Mehendi artist" later must be a data change, not a code change.

| Code | Archetype | How price is set | When the customer pays | Typical categories |
|---|---|---|---|---|
| `fixed` | Fixed-price package (instant book) | Provider's package price, shown up front | 100% at booking; add-ons as a change order | Salon at home, facial, waxing, deep cleaning, bathroom cleaning, pest control (standard), AC service, sofa cleaning, car wash, pet grooming |
| `inspect_quote` | Visit, then itemized quote (**exists today**) | Visit fee, then on-site quote | Visit fee at booking; balance before work | AC/appliance repair, electrician, plumber, carpenter, mechanic, painter (small jobs) |
| `proposal` | Request for proposal, then milestones | Providers send proposals to a brief; the customer picks one | Booking advance, then milestones, then final payment (schedule in the proposal) | Wedding planner, photographer/videographer, caterer, decorator, DJ/band, bridal makeup, mehendi, interior design, renovation, packers and movers, event venue (later) |
| `time_based` | Hourly/daily session or recurring plan | Rate × duration, or a session pack | Prepaid per session, or a prepaid pack/month | Tutor, yoga/fitness trainer, maid, cook, driver, babysitter, elder care (non-medical), music teacher |
| `remote` | Remote consultation (**later; not in this plan's build**) | Per session | Prepaid | Astrologer, CA/tax filing, legal docs, career coach |

**Location modes** are independent of archetype. A category allows one or more: `at_customer` (home visit), `at_provider` (salon/studio), `at_venue` (event address, may differ from the customer's address), `remote`.

---

## 2. Category catalogue (launch candidates)

Taxonomy is three levels: **vertical → category → service package**. Packages are provider-defined, but the platform supplies templates.

| Vertical | Category (slug) | Archetype | Pricing unit(s) | Location | Verification beyond KYC (confirm with counsel before launch) |
|---|---|---|---|---|---|
| Home repairs | ac-repair, electrician, plumber, carpenter, appliance-repair, painter (**existing**) | inspect_quote | job / hour | at_customer | Electrician: state licence where applicable |
| Home repairs | car-mechanic, bike-mechanic (**existing**) | inspect_quote | job | at_customer, at_provider | — |
| Cleaning | house-cleaning, water-tank-cleaning (**existing; move to fixed**), sofa-cleaning, bathroom-cleaning, kitchen-cleaning | fixed | job / sq.ft / seats / litres | at_customer | — |
| Cleaning | pest-control (**existing; move to fixed**) | fixed | job / BHK | at_customer | Pest-control operator licence |
| Beauty and wellness | salon-women-home, salon-men-home, bridal-makeup, party-makeup, mehendi, nail-art, spa-massage | fixed (bridal-makeup and mehendi: proposal) | package / person | at_customer, at_provider | Massage: women-only pros for women customers by default; stricter T&S review (abuse risk, store policy) |
| Events and weddings | wedding-planner, decorator, caterer, dj-sound, band-music, pandit-priest, event-anchor, tent-house | proposal (pandit: fixed) | per event / per plate / per day / per hour | at_venue | Caterer: FSSAI registration |
| Photography | photographer, videographer, pre-wedding-shoot, product-photography | proposal (simple shoots: fixed) | per hour / per event / per day + deliverables | at_venue, at_provider | — |
| Learning | home-tutor, music-teacher, yoga-trainer, fitness-trainer, dance-teacher | time_based | per session / monthly | at_customer, at_provider, remote | Tutors working with minors: police verification |
| Care | maid, cook, babysitter, elder-care-attendant, driver | time_based | per hour / per day / monthly | at_customer | Police verification (**mandatory**); driver: driving licence |
| Moving and big jobs | packers-movers, home-renovation, interior-design, civil-work | proposal | per job / per sq.ft | at_customer | Movers: transit insurance offering |
| Auto | car-wash, car-detailing, bike-service | fixed | package | at_customer, at_provider | — |
| Pets | pet-grooming, dog-walker, pet-trainer | fixed / time_based | package / session | at_customer, at_provider | — |

**Excluded at launch** (regulated or high risk): medical/nursing/physiotherapy, legal advice, financial advice, anything adult-adjacent, weapons/security guards with arms. Keep them in a `restricted` list that admin cannot enable without a legal sign-off flag.

> **Launch discipline (industry practice):** don't open all categories at once. Each category goes live per city only after it passes the Category Launch Checklist (§6.4), including minimum supply density. Urban Company scaled one vertical deeply before adding adjacent ones.

---

## 3. Data model changes

All amounts are **integer paise**. All new tables need **RLS enabled with explicit policies**. All state changes go through **security-definer RPCs** (the existing pattern in `0001_init.sql`).

### 3.1 Category configuration
Extend `categories` (added columns, nullable or with defaults so existing rows stay valid):

```
categories
  + vertical          text not null default 'home-repairs'     -- e.g. 'beauty', 'events'
  + parent_id         uuid null references categories(id)      -- optional grouping
  + archetype         text not null default 'inspect_quote'
                      check (archetype in ('fixed','inspect_quote','proposal','time_based','remote'))
  + location_modes    text[] not null default '{at_customer}'
  + pricing_units     text[] not null default '{job}'          -- allowed units (see 3.3)
  + intake_schema     jsonb not null default '{}'              -- JSON Schema for the booking brief (3.2)
  + payment_template  text not null default 'visit_then_balance'   -- key into payment_templates
  + cancellation_policy text not null default 'standard_visit'     -- key into cancellation_policies
  + commission_bp     int null                                 -- override in basis points; null = global tiers
  + min_lead_hours    int not null default 1                   -- earliest bookable start
  + max_lead_days     int not null default 7                   -- furthest bookable start (events: 365)
  + requires_docs     text[] not null default '{}'             -- e.g. '{fssai}', '{police_verification}'
  + restricted        boolean not null default false
  + config_version    int not null default 1
```
Keep `pricing_mode` for backward compatibility. Derive it from `archetype` (`fixed` → 'fixed', everything else → 'quote') in the same migration, and stop reading it in new code.

**Per-city enablement:** a new table `category_cities(category_id, city, live boolean, launched_at)`. Search returns only categories that are `live` in the customer's city.

### 3.2 Intake (the booking brief)
Each category has an `intake_schema` written in the exact grammar in §3.12 C12 (multi-selects are `array` with `items.enum`). Examples:
- **caterer:** `event_type` (enum), `event_date` (date), `guest_count` (int 10–5000), `cuisine` (multi-enum), `veg_only` (bool), `service_style` (buffet/plated/live counters), `venue_has_kitchen` (bool).
- **photographer:** `event_type`, `event_date`, `hours` (1–24), `deliverables` (edited photos, album, video, reels), `num_photographers` (1–6).
- **bridal-makeup:** `event_date`, `num_people`, `looks` (count), `trial_needed` (bool), `at_venue` (bool).
- **home-tutor:** `subject`, `grade`, `board`, `sessions_per_week`, `mode` (home/online).

Storage: `bookings.intake jsonb not null default '{}'` and `service_requests.intake` (3.5). Validate on the **server** in the RPC (`_validate_intake(category_id, intake)`, a PL/pgSQL validator for the supported subset) **and** on the client (same schema drives the form). The server is authoritative.

### 3.3 Packages and units
- New table `service_packages(id, provider_service_id, title, description, price, unit, duration_min, inclusions text[], exclusions text[], active, sort_order)`. Units: `job, hour, day, session, person, plate, sqft, bhk, seat, litre, event, month`. **Fixed archetype requires at least one active package.**
- Keep `rate_card_items` for the inspect_quote archetype (parts and labour price hints).
- Platform-provided **package templates** per category (`package_templates`), copied into the provider's packages during onboarding. Providers can edit price within a city band (`price_bands(category_id, city, unit, min, max)`), and admin sets the bands.

### 3.4 Quotes become generic line items
Extend `quote_item_kind` with `material, package, per_unit, travel, rental, discount, addon` (see the enum gotcha in §8). Add `quote_items.unit text null`. Keep the existing commission rule: **commission applies to service value (labour, package, per_unit, addon, travel), never to pass-through parts/material/rental with bill proof.** Encode the rule in one SQL function, `_commissionable(kind)`, and one TS function in `money.ts`. Unit tests must cover every kind.

### 3.5 Request-for-proposal (proposal archetype)
```
service_requests(id, customer_id, category_id, city, address_id null, venue_text null,
                 event_start timestamptz, event_end timestamptz, intake jsonb, budget_min int null,
                 budget_max int null, status ('open','closed','booked','expired','cancelled'),
                 expires_at, created_at)
proposals(id, request_id, provider_id, version, status ('sent','withdrawn','accepted','rejected','expired'),
          total int, valid_until, note, created_at)
proposal_items      -- same shape as quote_items
proposal_schedule   -- the payment milestones offered (3.6), same shape as payment_schedule
```
Rules:
- A request is shown to at most **N matching providers** (default 8, config): category live in the city, within radius, available on the date, verified, not suspended. Ranking reuses `search_providers` signals.
- Each provider can send one active proposal (new version supersedes the old one).
- Customer compares proposals side by side and accepts one. Accepting creates a `booking` with `archetype='proposal'`, copies items into `quotes` (version 1, status 'approved_pending_payment') and the schedule into `payment_schedule`, and closes the request. Other proposals become `rejected`.
- **Contact details stay masked until the booking advance is paid** (anti-leakage; chat is in-app only and the existing message rules apply).

### 3.6 Payment schedules (milestones)
```
payment_schedule(id, booking_id, seq, label, amount int, due_rule text, due_at timestamptz null,
                 status ('upcoming','due','paid','waived','refunded'), payment_id uuid null)
due_rule ∈ 'at_booking' | 'on_quote_approval' | 'days_before_start:<n>' | 'on_completion' | 'on_delivery'
```
**Payment templates** (data, table `payment_templates(key, rows jsonb)`). Providers can choose a template; percentages and days are adjustable only within admin bounds.

| Key | Schedule | Used by |
|---|---|---|
| `full_upfront` | 100% at booking | fixed |
| `visit_then_balance` | visit fee at booking → balance on quote approval (**today's flow**) | inspect_quote |
| `event_standard` | 25% advance at booking → 50% at `days_before_start:7` → 25% at `days_before_start:1` | caterer, decorator, planner, DJ |
| `creative_delivery` | 30% advance → 50% at `days_before_start:1` → 20% `on_delivery` | photographer, videographer |
| `project_milestones` | 20% at booking → up to 3 provider-defined milestones → 10% on completion | renovation, interior, movers |
| `session_prepaid` | each session prepaid, or pack price at booking | time_based |

Rules:
- **Platform-fee timing depends on the archetype.** `inspect_quote` keeps today's rule exactly: the fee is collected **with the balance only**, and there is no fee for rejected quotes or visit-only cancellations (doc 03 §4). `fixed`, `proposal` and `time_based` collect it with their **first payable obligation**. The fee is stored as its own booking-level obligation (`bookings.platform_fee`), separate from service principal, and is collected **at most once per booking**, regardless of retries or change orders. For high-ticket archetypes the amount comes from config (`platform_fee_rules` by archetype; e.g. proposal = 1% capped at ₹499; **DECISION** in §9).
- Obligation contract: see §3.12 C6.
- A cron job (`schedule-reminders`, every 15 min) moves milestones from `upcoming` to `due` when `due_at <= now()` and sends a reminder notification. **An overdue milestone after a grace period (config, default 48 h) lets the provider cancel under the policy.**
- Every milestone is a separate Razorpay Payment Link that uses the existing `create-payment` function, with `payments.purpose` extended to `advance | milestone | final | package | addon | session` (enum gotcha, §8).

### 3.7 Payouts for long-lead bookings
The current model holds the provider share until completion plus 24 h. **For a wedding booked 6 months ahead that would mean holding customer money for months. Before building this, check it with Razorpay and the CA against RBI Payment Aggregator settlement rules (UNVERIFIED; must be confirmed).** The design has to work under either answer:
- **Policy-aligned release (default):** a slice of the provider's entitlement becomes releasable only when the **same cancellation-policy evaluator** (§3.8) says it can no longer be refunded to the customer. The existing 24 h dispute window still applies after completion for the remainder. Never use a separate approximation of "non-refundable".
- **Keep `payouts` as the unique booking-level aggregate** (`payouts.booking_id` stays UNIQUE, `0001_init.sql:236`). Release tranches are rows in `payout_transfers`, each with `source_payment_id` and a new `release_after`. The aggregate entitlement is updated incrementally and idempotently as payments, refunds and milestones settle. Allocation respects each source payment's **remaining unrefunded, unallocated** capacity and its release eligibility. Never mark the aggregate `transferred` or close the booking just because the transfers created so far have finished; all final obligations and entitlements must be reconciled first.
- **Prerequisites before any early (pre-completion) release:** post-transfer disputes, transfer-reversal tracking, provider receivables/debt, and platform-funded refund liquidity (Razorpay refunds debit the platform account and need separate transfer reversals). See §3.12 C9.
- If Razorpay requires shorter holds, set the template so that refundable money is either not collected early or released, with the cancellation refund then recovered as **provider debt** (the existing P1 debt concept). This is weaker for the customer; choose it only if compliance forces it.

### 3.8 Cancellation policies
Table `cancellation_policies(key, rules jsonb)`. Each rule matches on **(cancelling actor, reason ∈ {customer_choice, provider_fault, customer_payment_default, customer_no_show, platform}, booking status, time before start)**. It yields explicit amounts on explicit bases: service principal paid, platform fee, advance treatment, prior refunds, provider compensation, and rounding (round refunds down to the paisa; the remainder goes to the provider). **The full policy is snapshotted into `bookings.cancellation_snapshot jsonb` at booking time.** Later policy edits never change existing bookings (industry practice, as Airbnb and UC do). One SQL evaluator, `_cancellation_outcome(booking_id, actor, reason, at)`, is the only source of refund and release amounts. A TS mirror exists only for display, and the two share test fixtures.

| Key | Rule summary (defaults to confirm, **DECISION**) |
|---|---|
| `standard_visit` | Existing PRD §5.10 rules (must reproduce them exactly) |
| `flexible` | Full refund until 3 h before; 50% after; 0% after the pro has arrived |
| `event_moderate` | Advance: fully refundable within 48 h of booking (cooling-off) if the event is more than 30 days away; non-refundable after that. Other paid milestones: 100% refund ≥30 days before start, 50% 7–30 days, 0% inside 7 days |
| `event_strict` | Advance: non-refundable after the 48 h cooling-off. Other paid milestones: 50% ≥15 days, 0% inside 15 days |

Reason-specific overrides (all policies):
- `provider_fault`: **100% refund** of everything paid, including the platform fee. The provider also gets a penalty (rating/visibility) and the customer gets a replacement offer (3 alternative providers available on that date).
- `customer_payment_default` (a milestone overdue past its grace period, with evidence of reminder notifications in `booking_events`): treated as a **customer cancellation at that moment** under the snapshot policy. It is **not** a provider-fault cancellation.
- `platform` (admin/safety): admin chooses the outcome inside an audited RPC.

### 3.9 Availability and double-booking
- `provider_availability(provider_id, weekday, start_time, end_time)` for regular hours.
- `provider_time_off(provider_id, tstzrange)`.
- `bookings.service_window tstzrange` and `bookings.exclusive boolean` (snapshotted from the category). Postgres exclusion constraints can't express "conflicts if **either** row is exclusive", so enforce it in the reservation function: under a per-provider advisory lock (`pg_advisory_xact_lock(hashtext(provider_id::text))`), reject the new booking if any **occupying** booking overlaps its window and either booking is exclusive. Occupying statuses: `pending_payment` (only while its payment hold is unexpired), `requested`, `accepted`, `confirmed`, `en_route`, `inspecting`, `quote_sent`, `awaiting_payment`, `in_progress`, `completion_requested`. Cancellation, expiry and decline release availability atomically.
- Multi-day events: `event_start`/`event_end` can span days; the UI shows the date range.

### 3.10 Booking state machine per archetype
Keep **one** `booking_status` enum and add only what's needed: `confirmed` (advance paid, waiting for the event date) and `delivery_pending` (event done, deliverables owed). Enforce allowed transitions per archetype in a table, `archetype_transitions(archetype, from_status, to_status, actor)`, checked inside `_set_status`. **Do not seed `inspect_quote` from the doc 04 diagram alone; it omits implemented paths.** For example, cancellation from `pending_payment`/`accepted`/`en_route`/`awaiting_payment`, `quote_sent → in_progress` when no balance is owed, dispute resolutions, and system/cron transitions are missing from it. First grep every `_set_status(` call in migrations 0001–latest and list each (from, to, actor) the code can produce. Seed that reconciled list, and update the doc 04 diagram to match in the same commit. **Today `_set_status` performs no transition check**, so this task adds one: test every pair through its real RPC, including wrong-actor rejection.

```
fixed:        pending_payment → requested → accepted → en_route → in_progress (start OTP)
              → completion_requested → completed → closed
              (add-ons during in_progress = change order, same as today)
inspect_quote: unchanged (doc 04 §3)
proposal:     [service_request + proposals] → pending_payment (advance link) → confirmed
              → (milestones paid over time) → in_progress (start OTP on event day)
              → completion_requested → completed | delivery_pending → completed → closed
time_based:   pending_payment → requested → accepted → in_progress (start OTP)
              → completion_requested → completed → closed  (one booking per session;
              packs create N session bookings sharing a pack_id)
Cancellation/dispute/refund transitions: available in every archetype, money per the snapshot policy.
```

### 3.11 Commission and revenue per vertical
- `categories.commission_bp` overrides the global tiers when set. Provider tiers (12 → 10 → 8%) still apply where no override exists.
- Suggested defaults (**DECISION**; benchmarks put repairs and beauty at 10–25% and high-ticket events lower): repairs 12% (unchanged); fixed beauty/cleaning 15%; proposal (events/photography) 8% capped at ₹5,000 per booking; time_based 10%.
- Leakage control for high-ticket categories: masked contact until advance, protection guarantee only for in-app payments, and the cap above (so paying in-app beats paying offline). An optional **lead fee** (Thumbtack-style) stays off by default; it is a later experiment.
- GST/TDS/TCS treatment **differs by category** (e.g. catering, beauty, housekeeping under GST s.9(5)). Add `categories.tax_profile text` and get a CA-approved matrix before enabling any non-repair category for live payments (**blocking**, extends PRD PAY5).

### 3.12 Binding contracts (from the design review; these override any looser wording above)
**C1. Booking snapshots.** Bookings gain `archetype`, `category_config_version`, `location_mode`, `pricing_snapshot jsonb`, `payment_template_snapshot jsonb`, `cancellation_snapshot jsonb`, `platform_fee_rule_snapshot jsonb`. They're set once at creation and are immutable afterwards (a trigger rejects updates). Existing bookings are backfilled to `inspect_quote` plus a `standard_visit` snapshot, **without changing stored prices or payment timing**. Every runtime handler (payment, cancellation, payout, transitions) reads the **booking snapshot**, never current category settings.

**C2. Eligibility guard.** One SQL function, `_assert_bookable(category_id, provider_id, city, archetype, window)`, is called by discovery **and** by every create/request/proposal/accept RPC. It checks: active category, `live` in the city, archetype enabled (feature flag), provider verified and not suspended, required docs approved and unexpired, not `restricted`, and lead-time bounds. Legacy `create_booking` must reject non-`inspect_quote` categories with error `upgrade_required`. Disabling a category stops **new** sales only; existing bookings keep payment, fulfilment, refund and dispute access.

**C3. Fixed bookings.** `create_fixed_booking(p_package_id, p_quantity, p_window, p_location, p_intake)` computes price **server-side**. A package is either `flat` (quantity must be 1) or `unit` (quantity validated against the package's `min_qty`, `max_qty` and `qty_step`). The function creates an immutable approved-pending-payment **package quote** with line items. A successful full payment activates that quote. Duration = `duration_min` × quantity for unit packages (or the flat duration) and sets `service_window`. **Start flow:** extend `arrive` so that, for `fixed` (and `time_based`) bookings, a valid start OTP moves the booking to `in_progress` directly; `inspect_quote` still goes to `inspecting`. Add-ons create a replacement full-scope quote version and charge or refund only the net difference, using the existing 0002 change-order safeguards.

**C4. Commissionable subtotal.** Replace the labour-only settlement input with `commissionable_subtotal`, computed from the approved quote's lines via `_commissionable(kind)`: labour, package, per_unit, addon and travel count; part, material and rental don't, and legacy `other` lines keep today's treatment. Discounts are stored as positive amounts on a `discount` line with a `target_item_id`; they reduce that line's commissionable basis. Pass-through lines over ₹500 need bill evidence, enforced server-side. Precedence: free period (0%) > category override > provider tier. The rate is evaluated at **booking creation** and snapshotted. The commission cap is **cumulative per booking**, never per milestone. GST on commission is rounded once, at the booking level.

**C5. Location.** `bookings.location_mode ∈ {at_customer, at_provider, at_venue, remote}`. `address_id` is required only for `at_customer`. `at_provider` uses a provider premises snapshot. `at_venue` stores the venue in `booking_private_location` (released per C8). `remote` has no address. Skip `en_route` when there's no travel (`at_provider`, `remote`).

**C6. Payment obligations.** Each `payment_schedule` row is unique on `(booking_id, seq)`. Every payment attempt references `schedule_id` (new column `payments.schedule_id`), and attempt history is kept. Under the booking lock, prepare or reuse **one live attempt for the selected obligation only**; never retire links belonging to other obligations (today's prepare logic retires all links for a booking, so it must be scoped by `schedule_id`). Schedule amounts must sum exactly to the approved service total. Percentage rounding remainders go to the **last** milestone. The platform fee is a separate obligation row. The webhook settles only the matching obligation; duplicate, stale or excess payments follow the existing idempotent refund handling. Paying the advance never marks future instalments paid. Due dates already in the past at creation are set to `due` immediately.

**C7. Confirmed / delivery_pending rules.**

| From | To | Actor | Guard | Side effects |
|---|---|---|---|---|
| pending_payment | confirmed | system (webhook) | advance obligation paid | release request-level hold; notify both |
| confirmed | cancelled | customer / provider / system | `_cancellation_outcome` with reason | refunds and releases per C9; free availability |
| confirmed | in_progress | provider + start OTP | event-day window; every obligation due on or before start is paid | — |
| in_progress | completion_requested | provider | — | `on_completion` obligation becomes `due` |
| in_progress | delivery_pending | provider | the category has deliverables | — |
| delivery_pending | completion_requested | provider via `submit_delivery` | links submitted | `on_delivery` obligation becomes `due` |
| completion_requested | completed | customer OTP/accept, or auto-confirm | **all obligations paid**; deliverable bookings get a 7-day acceptance window (config) instead of the normal 24 h auto-confirm | payout aggregate finalised |
| any active | disputed | customer | existing rules, plus post-transfer disputes (C9) | freeze unreleased entitlement |

An overdue obligation blocks the start transition. Past its grace period it allows the `customer_payment_default` cancellation (§3.8).

**C8. Proposal routing and privacy.** `request_recipients(request_id, provider_id, routed_at)` is UNIQUE, written only by a security-definer routing function; providers have no write grants. Providers read requests only through a **pre-payment projection view** (category, date, city/area, intake minus private fields, budget). Exact address, venue and contact live in `request_private` and `booking_private_location`, readable only by the customer, and by the selected provider **after the advance is settled**. Pre-booking Q&A uses request-scoped threads, `request_messages(request_id, provider_id, sender_id, body)`, with participant RLS and the same phone/URL masking rules as booking chat. Tests must try direct table, RPC and storage access, competing providers, and venue/intake leakage.

**C9. Refunds and early release.** Customer refunds are paid from the platform account and **never wait** for provider recovery. Released transfers are reversed through the Razorpay transfer-reversal API where possible. Any unrecovered amount becomes `provider_receivables` (debt), recovered from future payouts without double recovery. Disputes are allowed after a transfer and freeze all unreleased entitlement immediately. Races between cancellation, dispute and transfer processing are handled under the booking lock, with reconciliation after ambiguous gateway responses (status poll before retry).

**C10. Proposal acceptance is atomic.** `accept_proposal` locks the request row (`for update`) and takes the provider's advisory lock. It revalidates proposal version, status, expiry and availability, then idempotently creates **at most one** active booking per request, in `pending_payment` with a payment hold (default 30 min). If the hold expires, the payment link is retired, availability is released, and the request and other proposals **reopen**. Only after the advance is paid do other proposals become `rejected` and the request `booked`.

**C11. Packs (time_based).** A `pack_purchases(id, customer_id, provider_service_id, sessions_total, price, platform_fee, payment_id, expires_at)` ledger stores immutable per-session allocations (`pack_sessions(pack_id, seq, booking_id null, allocated_amount, status)`), whose sum equals the pack principal. The platform fee is charged once per pack. Session payouts draw only up to their allocation from the pack's source payment, never exceeding remaining capacity. An unused-session refund = remaining allocations (i.e. at the discounted per-session price) minus no-show-consumed sessions. Expired packs follow the snapshot policy (**DECISION** in §9). Cancelling a pack cancels future generated session bookings.

**C12. Intake schema grammar.** Supported grammar: `type` ∈ object/string/integer/number/boolean/array; `properties`; `required`; `enum`; `minimum`/`maximum`; `minLength`/`maxLength`; `format: date | date-time`; arrays with `items` (one of the scalar types, with optional `enum`), `minItems`, `maxItems`, `uniqueItems`; plus `title`/`description` for labels and an `x-private: true` marker for fields hidden from pre-payment projections. **Anything else is rejected when admin saves the category config.** In production, an unsupported schema shows a **blocking** "this service is temporarily unavailable" state and logs an error. Fields are never silently hidden. The client and server validators share one conformance fixture file, `supabase/tests/fixtures/intake-conformance.json`.

---

## 4. App changes (Expo app)

| Area | Change | Files (create or edit) |
|---|---|---|
| Home | Vertical tabs/sections (Home services, Beauty, Events and Weddings, Learning, Care, Auto, Pets); categories come from the server (`categories` + `category_cities`), **never hard-coded** | `app/app/(customer)/index.tsx`, `app/src/lib/supabaseApi.ts`, `apiTypes.ts`, demo mirror in `app/src/lib/demo/` |
| Category screen | Shows packages (fixed) or providers (inspect_quote/time_based) or a "Get proposals" CTA (proposal), driven by `archetype` | `app/app/category/[slug].tsx` |
| Intake form | One generic `<SchemaForm schema value onChange>` component that renders from `intake_schema`, using exactly the grammar in §3.12 C12. Unsupported schema → a blocking "service temporarily unavailable" state plus a logged error (never silently hide a field). Validated against the shared conformance fixture | `app/src/components/SchemaForm.tsx` + tests |
| Booking | Book screen branches by archetype: fixed = package picker + slot + pay full; inspect_quote = today's screen unchanged; time_based = duration/pack picker | `app/app/book/[providerServiceId].tsx` (split into `app/src/features/booking/*` per archetype) |
| Proposals | New: post request → "proposals arriving" → compare table (price, inclusions, rating, response time, cancellation policy) → accept → pay advance | `app/app/request/new.tsx`, `app/app/request/[id].tsx`, `app/app/proposal/[id].tsx` |
| Payments | Payment schedule timeline component (paid / due / upcoming, pay button per due milestone) on booking detail | `app/src/components/PaymentSchedule.tsx`, `app/app/booking/[id].tsx` |
| Provider onboarding | Category-specific requirements (docs from `requires_docs`), package templates, price band hints, availability editor | `app/app/onboarding*`, `app/app/(provider)/pro-account.tsx` |
| Provider inbox | "Requests for proposal" tab with a proposal composer (line items + schedule template + validity) | `app/app/(provider)/dashboard.tsx`, new `app/app/proposal/compose/[requestId].tsx` |
| Provider calendar | Day/month view of confirmed bookings and time off; blocking dates | `app/app/(provider)/calendar.tsx` |
| Deliverables | Provider uploads the delivery link/files; customer accepts → completes (photography/video) | booking detail + new RPC |
| AI assistant | Tools learn archetypes: extract `intake` per `intake_schema`; for proposal categories create a **draft service request** (user confirms before posting); never book or pay | `supabase/functions/ai-assistant/*`, policy files (see doc 06) |
| Copy/i18n | All new strings go through the i18n layer used by the app (Hindi/Telugu ready) | i18n files |

Design rules: reuse `app/src/theme` and `app/src/components/ui` only. Follow doc 02 patterns (status-first booking detail, sticky CTA, price card). Show prices including all fees before payment (Urban Company's "price before the doorbell" principle).

---

## 5. Backend RPCs and functions

New or extended RPCs (security definer, `_require_uid()`, `_assert`, row locks via `_lock_booking`, all write `booking_events`):
- `get_catalog(p_city)`: verticals, live categories, archetype, intake_schema, location_modes.
- `upsert_service_package(...)`, `delete_service_package(id)`: provider owns the row; price within the band.
- `create_fixed_booking(p_package_id, p_slot, p_address_id, p_intake)`: computes the price **server-side** from the package (never trust a client price).
- `create_service_request(...)`, `cancel_service_request(id)`.
- `send_proposal(p_request_id, p_items, p_schedule, p_valid_until, p_note)`, `withdraw_proposal(id)`.
- `accept_proposal(p_proposal_id, p_address_id)`: creates the booking, quote, schedule and the first payment.
- `pay_milestone(p_schedule_id)`: returns a payment link through the existing `create-payment` function (extend its purpose handling).
- `submit_delivery(p_booking_id, p_links)`, `accept_delivery(p_booking_id)`.
- `set_availability(...)`, `add_time_off(...)`.
- Extend `create-payment`, `razorpay-webhook`, `release-payouts` and `process-refunds` for per-obligation payments (C6), release tranches (§3.7), milestones and policy snapshots. **These are payment paths: Opus review is mandatory (§8).**
- New cron function `schedule-reminders` (milestone due/overdue, event-day reminders, proposal expiry, request expiry), following the existing `x-cron-secret` pattern.

---

## 6. Trust, safety, compliance and operations

### 6.1 Verification per category
Driven by `requires_docs`. Documents are uploaded to a **private** bucket with size/type limits (≤10 MB; jpg/png/pdf), admin review queue, and expiry dates (FSSAI and licences expire). A provider can't go live in a category until its required docs are `approved`.

### 6.2 Safety
- Care and beauty categories: women customers can choose women-only professionals (filter plus provider gender as self-declared and verified at KYC).
- Event-day SOS and share-booking-details, as already planned for home visits.
- Massage/spa: stricter T&S, no free-text "special requests", and report/ban flow; review against Play/App Store policies before enabling.

### 6.3 Reviews
Category-specific review dimensions (e.g. photography: delivery timeliness, quality; catering: taste, hygiene). Store them in `reviews.dimensions jsonb` and keep the existing columns for repairs.

### 6.4 Category Launch Checklist (per category, per city). All must be YES before `category_cities.live = true`
1. `intake_schema`, packages/templates, payment template and cancellation policy are configured and reviewed.
2. The CA has approved the tax profile for the category.
3. Required verification docs are defined and the admin review queue is staffed.
4. Supply: at least **10 verified providers** (fixed/time_based) or **5** (proposal) in the city, with real availability.
5. Price bands are set from real local market data (collected during provider onboarding, not invented).
6. Production-shaped E2E has passed: new user, no history, zero matches, cancellation at every policy boundary, failed payment, overdue milestone.
7. Support macros and FAQ are written for the category.
8. Analytics funnel events are firing for the category.

---

## 7. Implementation task list (execute in order; one PR/commit series per task)

Each task lists **Do**, **Done when**, and **Review**. "Opus review" means running a `code-review` or `rubber-duck` pass with Claude Opus 5.5 before merging. Never skip it on payment/RLS/migration tasks.

### Phase 0: Generalize the platform with zero behaviour change
**T0.1 Migration: category config columns plus taxonomy**
- Do: create `supabase/migrations/<next>_category_config.sql` (next free number; check `supabase/migrations/`). Add the §3.1 columns and `category_cities`. Backfill the 11 existing categories: archetype `inspect_quote`, vertical `home-repairs` (cleaning/pest/tank → vertical `cleaning`, archetype still `inspect_quote` until T1.x). Insert `category_cities` rows only for the launch city as `live=true`, and **derive the city from an existing config value; never hard-code a test city in app code**.
- Done when: PGlite tests (`supabase/tests/migration.test.mjs`) pass unchanged, a new test asserts the backfill, and RLS lets anon read only `live` categories.
- Review: Opus (migration + RLS).

**T0.2 Booking snapshots + eligibility guard (§3.12 C1, C2)**
- Do: new migration adding the C1 snapshot columns, an immutability trigger, and a backfill of existing bookings (`inspect_quote` + `standard_visit`, prices and timing unchanged). Update `create_booking` to write the snapshots and to call `_assert_bookable`, rejecting non-`inspect_quote` categories with `upgrade_required`.
- Done when: every existing test passes; new tests prove snapshots are written, immutable, and backfilled; and `create_booking` rejects a category that is not live or not inspect_quote.
- Review: Opus (migration + money).

**T0.3 Reconciled transition table (§3.10)**
- Do: grep every `_set_status(` call and status update in migrations 0001–latest. Write the full (archetype, from, to, actor) list for `inspect_quote`, including cancellations, zero-balance `quote_sent → in_progress`, dispute resolutions and cron/system transitions. Seed `archetype_transitions` with it, add the check inside `_set_status` (reading `bookings.archetype`), and update the doc 04 diagram to match.
- Done when: a test drives **every allowed pair through its real RPC** and asserts a wrong actor is rejected, and the full existing suite passes unchanged.
- Review: Opus.

**T0.4 Server-driven catalog in the app**
- Do: add `get_catalog` and replace any hard-coded category list in the app with it (search the app for category slugs/icons). Add the demo-mode mirror.
- Done when: CI typecheck and jest pass, and a city with no live categories shows a proper empty state.

**T0.5 Generic money engine (§3.4, §3.12 C4)**
- Do: enum additions in their own migration. Then add `_commissionable(kind)` in SQL and `isCommissionable(kind)` in `money.ts`, switch settlement from `subtotal_labour` to `commissionable_subtotal`, add discount lines with `target_item_id`, add the `commission_bp` override with the C4 precedence, and keep the cumulative per-booking cap.
- Done when: unit tests cover every kind in TS and SQL with identical fixtures, the doc 03 worked example still gives ₹1,937.60, and a legacy booking with `other` lines settles exactly as before.
- Review: Opus (payments).

### Phase 1: Cancellation policies, obligations and fixed-price packages (cleaning, salon at home, pest control, car wash)
**T1.1** Cancellation policy tables, the snapshot and the `_cancellation_outcome` evaluator (§3.8). `standard_visit` must reproduce PRD §5.10 exactly; test every boundary and reason. **Opus review.**
**T1.2** Payment obligations (§3.6, §3.12 C6): `payment_schedule`, `payments.schedule_id`, prepare logic scoped by obligation, webhook settling a single obligation, and the platform fee as a separate obligation. Existing inspect_quote flows are represented as obligations without changing amounts or timing. **Opus review.**
**T1.3** `service_packages`, `package_templates`, `price_bands` tables (flat/unit, qty bounds) with RLS and provider RPCs. **Opus review.**
**T1.4** `create_fixed_booking` per C3 (server-priced package quote, `full_upfront`, OTP straight to `in_progress`, add-ons via net-difference change orders), `fixed` transitions, and the availability check from §3.9 for its window. **Opus review.**
**T1.5** App: package picker on the category screen, fixed Book screen with quantity, provider package editor (template → edit within band), and the payment schedule component.
**T1.6** Move house-cleaning, water-tank-cleaning and pest-control to `fixed` **only after** T1.1–T1.5 are green, each has packages, and the city has supply. In-flight bookings keep their snapshotted archetype.
- Phase done when: an end-to-end production-shaped run (new customer → package → pay → OTP → add-on → complete → payout, plus cancellation at each policy boundary) passes in `e2e-web.yml` and in live API scenarios, **using freshly created users, not seed IDs**.

### Phase 2: Availability and release tranches
**T2.1** Availability, time off and the reservation check with advisory lock (§3.9) on all booking paths.
**T2.2** Release tranches in `payout_transfers` (§3.7, keeping booking-level `payouts`), plus provider receivables, transfer reversals and post-transfer disputes (§3.12 C9). **Blocked until** the Razorpay/CA hold-duration answer (B1) is recorded in §9. **Opus review.**

### Phase 3: Proposals and milestones (photographer first, then makeup, caterer, decorator, planner)
**T3.1** `service_requests`, `request_recipients`, `request_private`, the pre-payment projection view, `proposals`, `proposal_items`, `proposal_schedule`, and `request_messages` with RLS per §3.12 C8. **Opus review.**
**T3.2** Routing function (top N matching providers, eligibility guard) and `send_proposal`/`accept_proposal` with atomic hold and reopen per C10. **Opus review.**
**T3.3** Milestone engine: `schedule-reminders` cron, `pay_milestone`, overdue → `due` → grace → `customer_payment_default` per C6/C7. **Opus review.**
**T3.4** `confirmed`/`delivery_pending` statuses (enum migration first) and the C7 matrix, including the deliverable acceptance window that excludes these bookings from the 24 h auto-confirm. **Opus review.**
**T3.5** App: request wizard (SchemaForm), proposals compare, request Q&A thread, payment schedule timeline, provider proposal composer, deliverables submit/accept.
**T3.6** Location modes (§3.12 C5) and private venue release after advance; leakage tests on table, RPC and storage.
- Phase done when: full photographer scenario passes (request → 3 proposals → accept → hold → advance → milestones over simulated time → event-day OTP → delivery → accept → payouts), plus hold expiry/reopen, concurrent accept, overdue default, and cancellation at each policy boundary.

### Phase 4: Time-based and recurring
**T4.1** Session bookings (OTP → `in_progress`) and the pack ledger per §3.12 C11. **Opus review.**
**T4.2** Recurring weekly schedule (maid/cook/tutor) generating future session bookings with pay-per-session or monthly prepaid.
**T4.3** Police-verification document gating for care categories (via `requires_docs` + eligibility guard).

### Phase 5: Category launches (repeat per category)
Fill config + templates + intake schema + review dimensions → run the §6.4 checklist → set live per city. **No code changes should be needed. If one is, the archetype design missed something: fix it generically and update this doc.**

### Cross-cutting (run alongside the phases)
- AI assistant: update tools/policies per archetype after each phase (see doc 06). Add deterministic tests for intake extraction for every launched category.
- Admin console: category config editor, doc review queue, price bands, milestone/payout overrides (audited).
- Analytics: funnel events per archetype.

---

## 8. Rules for every task (read before coding)

1. **Never edit `0001_init.sql` or any migration already applied.** Add a new numbered migration. Apply it live via the Supabase Management API query endpoint, then insert its version into `supabase_migrations.schema_migrations` (see README). Do it in a transaction with a dry run (`begin; ...; rollback;`) first.
2. **Postgres enum gotcha:** `alter type ... add value` cannot be used in the same transaction as statements that use the new value. Put enum additions in their own migration file, applied before the migration that uses them.
3. **Money:** integer paise only. All prices computed **server-side**; the client only displays. Every new money path needs SQL and TS tests with explicit rupee examples.
4. **RLS:** every new table has `enable row level security` plus explicit policies. Add a test that an unrelated authenticated user cannot read or write it.
5. **No test-data dependence:** no seed UUIDs, test phone numbers, fixed cities or coordinates in app or function code. Demo data lives only in `app/src/lib/demo/` and `supabase/seed*.sql`, behind explicit demo mode. Tests must create their own users and data.
6. **Backward compatibility:** in-flight bookings keep the archetype, policy and fees snapshotted at creation. The repair flow (inspect_quote) must not change; the full existing test suite must stay green.
7. **Feature flags:** every new archetype is behind a server flag (`app_config` table or category `live` per city) so it can be switched off without an app release.
8. **Industry standard check:** before building each UI flow, note in the PR description which comparable product pattern it follows (e.g. "proposal compare table, pattern used by Thumbtack/WedMeGood"). Don't copy proprietary designs or text.
9. **Validation per task:** run the GitHub Actions workflows (`publish-app.yml` for app, `deploy-backend.yml` for functions/migrations, `e2e-web.yml` for flows). A task isn't done until CI is green **and** a live API check of the new path has passed.
10. **Review gate:** any change touching payments, payouts, refunds, RLS, migrations, auth or the AI assistant's tools must get an Opus review before merge. Fix all high-confidence findings.
11. **Docs:** when a task changes behaviour, update the affected doc (03 for money, 04 for state machine/data model, 01 for policy) in the same commit.
12. **Stop rule:** if a step needs a decision marked **DECISION** or is **blocked** in §9, stop and ask the founder instead of guessing.

---

## 9. Decisions and blockers for the founder

| # | Item | Recommendation | Status |
|---|---|---|---|
| D1 | Commission per vertical (§3.11) | Repairs 12% tiers; fixed 15%; proposal 8% capped ₹5,000; time_based 10% | **DECISION** |
| D2 | Platform fee for high-ticket bookings | 1% capped ₹499 on proposal; ₹29 elsewhere | **DECISION** |
| D3 | Cancellation policy defaults (§3.8) | As in the table | **DECISION** |
| D4 | First new vertical to launch | Fixed-price cleaning + salon at home (fastest, repeat demand), then photography as the first proposal category | **DECISION** |
| D5 | Lead fee experiment for proposals | Off at launch | **DECISION** |
| D6 | Expired prepaid packs (unused sessions) | Refund remaining allocations minus a 10% admin fee if expired by the customer's inaction; 100% if the provider is unavailable | **DECISION** |
| D7 | Deliverable acceptance window | 7 days, then auto-accept | **DECISION** |
| B1 | Maximum duration Razorpay Route can hold funds; RBI PA settlement rules for advances | Ask Razorpay support + CA | **BLOCKER for T2.2/Phase 3** |
| B2 | GST/TDS/TCS matrix per category (s.9(5) ECO liability for beauty, housekeeping etc.) | CA engagement | **BLOCKER before any live non-repair payments** |
| B3 | Licences required per category in the launch state (electrician, pest control, FSSAI, police verification) | Legal check | **BLOCKER before each category goes live** |
| B4 | App name (should not say "repair"/"fix" if covering all services) | Prefer a broad name (see PRD §11 naming notes) | **DECISION before store upload** |
