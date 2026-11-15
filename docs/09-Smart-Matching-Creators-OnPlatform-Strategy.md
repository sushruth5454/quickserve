# QuickServe — Smart Matching, Creators & Events, and On-Platform Strategy

**Status:** Approved plan, not yet implemented. **Executor:** any model, by following this document literally.
**Depends on:** `07-Multi-Category-Expansion-Plan.md` (archetypes, packages, proposals, deliverables, contracts C1–C12) and `08-Provider-Onboarding.md` (onboarding, go-live, payout rails). Read both first. The §8 rules of doc 07 apply to every task here.

Three parts:
- **A.** AI matching that understands reviews and specialities ("good makeup artist for oily skin"), with nearest-best and farther-best options that need the provider's approval.
- **B.** Creator and event categories (photographers, reel makers, influencers, caterers…) with social profiles, websites and per-deliverable pricing.
- **C.** Product strategy to keep bookings and payments in the app, a coins loyalty programme, and revenue for when transactions still leak.

---

## Part A — Review-aware AI matching with distance tiers

### A1. What exists today (verified in code)
- `supabase/functions/ai-assistant/logic.ts:272` `rankProviders()` ranks by rating, the customer's past ratings and nearest distance. It doesn't read review text, specialisations, or provider attributes.
- The search radius is the provider's `service_radius_km`. Providers outside it are never shown (`search_providers`, latest version in `0009_provider_onboarding.sql:1210`).
- Provider specialisations exist as `category_skills` (`0009:69`). Reviews have overall and dimension ratings plus a comment (`0001_init.sql:266`).

### A2. Target behaviour (example)
Customer: *"Need a makeup artist for my sister's engagement, she has oily skin, budget around ₹8k."*
The assistant answers with up to three clearly labelled groups:

| Group | Rule | Shown as |
|---|---|---|
| **Best match near you** | Inside the provider's normal radius; highest match score (§A4) | "Priya S · 4.8★ (63) · 3.2 km · 'Oily skin, long-lasting' mentioned in 9 reviews" |
| **Nearest good option** | Nearest provider with Bayesian rating ≥ 4.3 and a match score above the threshold | "1.1 km away · 4.5★" |
| **Top rated, travels to you** | Outside the normal radius but inside the provider's **max travel distance**; match score must beat the best nearby by a clear margin (config, default +10%) | "Ananya K · 4.9★ (120) · 18 km · +₹400 travel · **needs Ananya's confirmation**" |

Each pick shows **why**, citing real evidence (counts and short anonymised review quotes the server returned). The AI never invents evidence.

### A3. Data model (new migration; use the next free number)
1. **Provider attributes per service.** `categories.profile_schema jsonb` holds provider-side attributes, written in the **same grammar as doc 07 C12** (e.g. makeup: `skin_types_expert` multi-enum [oily, dry, combination, sensitive, acne-prone, mature], `techniques` [HD, airbrush, traditional], `brands_used`, `bridal`, `trial_offered`). Add `provider_services.attributes jsonb not null default '{}'`, validated server-side against the schema on save (one validator shared with intake, `_validate_schema`).
2. **Review tags.** Add `categories.review_tags text[]` (e.g. makeup: `long_lasting, oily_skin, natural_look, punctual, hygiene`). Add `reviews.tags text[]`; the customer picks up to 5 of them in the review screen. Server validation: tags must be in the category list.
3. **Review insights (derived; never edited by hand).**
   `review_insights(provider_service_id, aspect text, positive int, negative int, evidence jsonb, model text, policy_version text, updated_at)`. `evidence` is at most 3 items `{review_id, quote ≤ 140 chars}`, with PII redacted using the same redactor as the AI job brief (`brief.ts`). RLS: public read only through a view without review_ids; write by service role only.
4. **Travel policy per service.** Add to `provider_services`:
   - `max_travel_km int null`: null means no travel beyond the radius. Must be ≥ `service_radius_km` and ≤ 100.
   - `travel_fee_mode text check in ('none','flat','per_km')`, plus `travel_fee_flat int` (paise) and `travel_fee_per_km int` (paise per km beyond the radius).
   - Always requires provider approval beyond the radius; there's no instant booking there.
5. **Travel approvals.**
   `travel_requests(id, customer_id, provider_service_id, window tstzrange, distance_km numeric(5,1), quoted_fee int, status ('pending','approved','declined','expired','used'), expires_at, created_at)`.
   - RLS: customer and provider of the row only.
   - Expiry: 2 h, or 30 min before the slot, whichever is earlier.
   - `create_booking` / `create_fixed_booking` must require a `travel_request_id` with status `approved`, the same customer, service and window, and not expired, whenever the distance exceeds `service_radius_km`. The travel fee becomes a `travel` quote line (doc 07 §3.4, commissionable) and status changes to `used` atomically.

### A4. Match score (deterministic, server-side; the model never computes it)
Implement in SQL as `match_providers(p_category_slug, p_lat, p_lng, p_needs jsonb, p_window)`. It returns rows with components so the TS layer and tests can explain the result.

```
bayes_rating   = (C·m + Σratings) / (C + n)          -- m = category mean, C = 10 (config)
need_match     = for each requested need (from attribute enums and review tags):
                   declared = provider attribute contains it          → 0.5
                   evidence = review_insights.positive ≥ 3 and positive ≥ 3×negative → 0.5
                 average over needs (0..1); 0 needs → 0.5 neutral
distance_pen   = min(distance_km / max(radius_km,1), 2) × 0.1
reliability    = completion rate (completed / accepted, last 90 d, Bayesian) − cancel penalty
score          = 0.45·(bayes_rating/5) + 0.35·need_match + 0.15·reliability − distance_pen + 0.05·repeat_bonus(customer)
```
- Eligibility = `_provider_is_live` + availability for the window (`_provider_slot_problem`) + distance ≤ radius (tier 1/2), or ≤ `max_travel_km` (tier 3).
- Weights live in `app_config.match_weights` (jsonb) and are snapshotted into the AI log for every answer.
- **Fairness guards:** providers with fewer than 3 reviews get `bayes_rating` from the prior, not 0. Show at most 1 "new pro" slot when one exists and passes the need match ("New on QuickServe"), to avoid locking out newcomers (industry practice: cold-start boosts).

### A5. Review-insights job
- Edge Function `review-insights`, run by a cron every 30 min on reviews changed since the last run. Cap: 200 reviews per run.
- Gemini is called with a **fixed taxonomy**: allowed aspects = the category's `review_tags` plus the attribute enum values. Output is validated JSON: `{review_id, aspects:[{aspect, sentiment: pos|neg}], quote}`. Drop unknown aspects. The quote must be a verbatim substring of the comment after redaction; otherwise drop the quote.
- Store the result, aggregated per provider service. Recompute fully when `policy_version` changes.
- Cost control: only reviews with comments of 20 characters or more; batch 20 reviews per call; skip unchanged ones.
- Abuse: only reviews from **completed, in-app-paid** bookings exist (already enforced). Reviews by a customer whose account is under 24 h old, or that look like duplicate text across providers, are excluded from insights (flag them for admin).

### A6. AI assistant changes (`supabase/functions/ai-assistant/`)
1. Intake policy (`policies/intake.ts`): extract `needs` = attribute values and review tags from the conversation, but only values in the category's lists. Unknown wishes stay as free-text `notes` and are never matched.
2. Replace the `search_providers` tool's ranking with `match_providers`. Return `tier`, score components, `distance_km` (1 decimal), `travel_fee`, `needs_approval`, and up to 2 evidence quotes per need.
3. `rankProviders()` becomes a thin formatter. Keep the history boost (the customer's own past 4★+ pro) as `repeat_bonus`.
4. Output policy: always label tiers. Tier 3 must say "needs the pro's confirmation" and show the travel fee. Quote evidence only from tool output. Never claim "best in city".
5. Drafting for tier 3: `draft_booking` returns `draft_kind: 'travel_request'`. The app shows "Ask Ananya to travel (+₹400)". On tap → `create_travel_request` RPC → the provider gets a notification (outbox from 0007) → provider approves or declines in the app → the customer gets a notification → the booking continues with the approved request. **AI never sends the request itself; the customer taps.**
6. Policy version bump; deterministic tests: needs extraction only from allowed values, evidence must come from tool output, tier labelling, tier 3 never presented as bookable without approval.

### A7. App changes
- Provider: in "My services", add an "Attributes & specialities" form (SchemaForm from doc 07 C12) and a "Travel" section (max distance, fee mode, preview "A customer 15 km away pays +₹250").
- Provider: a **Travel requests** inbox card on the dashboard with a countdown (approve with fee / decline with reason).
- Customer: the provider profile shows specialities and "What customers mention" chips with counts. The review screen gets tag chips.
- Customer: category list "Farther pros who travel" section (collapsed by default) with a fee badge. The booking flow for them starts with "Request availability".

---

## Part B — Creators, events and other high-touch services

### B1. Category additions (data only; uses doc 07 archetypes)
Location mode `remote` is now **in scope for creator deliverables only** (content delivered online), not for consultations.

| Vertical | Category | Archetype | Pricing types allowed |
|---|---|---|---|
| Creators | instagram-influencer, youtube-creator, ugc-creator (content for brands without posting), reel-maker/editor, podcast-editing | fixed (packages) or proposal | fixed, range, from, quote |
| Photo & video | wedding-photographer, candid-photographer, pre-wedding-shoot, maternity-newborn, product-photographer, event-videographer, drone-operator (licensed), photo-booth | proposal (simple shoots: fixed) | fixed, range, from, quote |
| Weddings & events | wedding-planner, caterer, decorator, mehendi-artist, bridal-makeup, dj, live-band, anchor-emcee, choreographer, pandit, tent-lighting, invitation-designer | proposal (pandit, mehendi small: fixed) | fixed, range, per_unit (plate, hour, guest), quote |
| Beauty & wellness | makeup-artist, hair-stylist, nail-artist, salon-at-home, yoga, fitness-trainer | fixed / time_based | fixed, from |
| Learning & skills | tutor, music-teacher, dance-teacher, art-classes, language-tutor | time_based | per session, pack |
| Business services (B2B) | graphic-designer, social-media-manager, website-builder, ca-gst-filing (**restricted; legal check**) | proposal | quote, range |

### B2. Pricing types (extends doc 07 §3.3 `service_packages`)
Add `price_type text check in ('fixed','range','from','quote')`, plus `price_min`, `price_max` (paise).
- `fixed` → price = min = max.
- `range` → shown as "₹6,000–₹12,000". The **final price is always fixed** before payment, via the proposal or quote step.
- `from` → "From ₹6,000".
- `quote` → "Price on request".

**Rule:** a customer can never pay a range. Every range, from or quote package goes through a proposal or quote (doc 07 §3.5), which yields one fixed amount with line items before any payment. The match score's budget fit uses `price_min`/`price_max` against the customer's budget.

Package fields for deliverable work: `deliverables jsonb` (list of `{type, qty, spec}`, e.g. `{reel, 1, "30–60 s, 9:16, 1080p"}`), `turnaround_days`, `revisions_included`, `raw_files_included bool`, `usage_rights jsonb` (`{organic_posting: true, paid_ads_days: 0|30|90|365, exclusivity_days}`), `travel_included_km`. These are shown verbatim on the package card and copied into the proposal or quote (immutable snapshot, doc 07 C1).

### B3. What each profile shows (driven by `categories.profile_schema` + package fields; **no per-category code**)

| Category | Provider attributes (`profile_schema`) | Portfolio requirement | Verification (`requires_docs` / social) |
|---|---|---|---|
| Instagram influencer | niches (multi), languages, audience top cities (from API if connected), followers, avg reel views (last 10), engagement %, content styles, past brand collaborations (names, optional) | ≥ 6 posts (links to own posts) | Instagram **connected** (Business/Creator) for the "Verified stats" badge; otherwise "self-reported" label |
| YouTube creator | niches, subscribers, avg views (last 10), formats | ≥ 3 videos | YouTube connected |
| UGC creator / reel maker | styles (talking-head, product demo, cinematic), equipment, editing software, turnaround | ≥ 6 sample videos | — |
| Photographer | styles (candid, traditional, fine-art, documentary), events covered, equipment, team size, album options, drone (with DGCA licence if offered) | ≥ 12 photos across ≥ 2 shoots (albums) | Drone: DGCA RPC (`requires_docs`) |
| Videographer | formats (highlight film, full ceremony, reels), resolution, same-day edit, team | ≥ 3 videos | — |
| Caterer | cuisines, veg/non-veg/jain, min/max guests, per-plate tiers (silver/gold/platinum menus), live counters, tasting session, staff/service style, equipment provided | ≥ 8 food/setup photos + sample menus (PDF) | FSSAI (mandatory, doc 07 B3) |
| Decorator | themes, floral/non-floral, venues worked, setup time, teardown included | ≥ 10 photos | — |
| Makeup artist | skin types expert, techniques (HD/airbrush), bridal, brands used, trial, travel | ≥ 10 looks | — |
| Mehendi artist | styles (Arabic, Rajasthani, bridal), cones per hand, natural henna | ≥ 8 photos | — |
| DJ / band / anchor | genres, equipment, languages, hours, sample sets | ≥ 2 audio/video clips | — |
| Wedding planner | budget range handled, guest range, vendor network, full/partial planning | ≥ 3 events with photos | GST registration (recommended) |

**Social and web links.** New table `provider_links(id, provider_id, kind ('instagram','youtube','facebook','website','behance','google_business','other'), url, handle, verified_method ('oauth','dns','manual','none'), stats jsonb, stats_synced_at, created_at)`.
- RLS: public read of `kind, url, handle, verified_method, stats` only once the provider is live; write by owner only.
- **URL safety:** https only; blocklist of URL shorteners; links render as non-clickable text until admin approval for the first link of a new provider (anti-spam).
- **Leakage rule:** links are portfolio-only. Contact details (phone, WhatsApp, email) are never shown and are stripped from bios and captions by the existing chat masking rules. Social profiles are exactly where off-platform contact happens; see Part C.

### B4. Social verification
- **Instagram:** "Instagram API with Instagram Login". Works only for **Business/Creator** accounts; personal accounts can't connect (the Basic Display API was shut down on 4 Dec 2024). Scope `instagram_business_basic` gives profile, followers and media. Needs **Meta app review** (founder action: Meta developer account, privacy policy URL, screencast). Tokens: short-lived 1 h → long-lived 60 days, refreshed by a cron; stored encrypted (Supabase Vault), never sent to the client. Sources: Meta Instagram Platform docs; summaries at getphyllo.com and upload-post.com (2026).
- **YouTube:** YouTube Data API v3, OAuth scope `youtube.readonly`; `channels.list` (mine=true) → subscriber and view counts. Google OAuth consent screen verification is a founder action.
- **Website:** optional DNS TXT or `<meta name="quickserve-verify">` check by an Edge Function.
- **Fallback (until app review passes):** manual — the provider submits a screen recording of their profile insights; an admin approves and sets `verified_method='manual'`. Stats are then labelled "self-reported".
- **Never scrape** Instagram/YouTube pages (against their terms).
- Stats refresh daily for connected accounts. If the token expires or is revoked → stats are hidden and the badge shows "Stats not current".

### B5. Compliance for influencer bookings
- ASCI influencer advertising guidelines: paid promotions must carry a clear disclosure (#ad / "Paid partnership"). The booking terms require it, and the deliverable checklist includes "disclosure present". **Verify the current guideline text before launch.**
- Customers booking creators are often **businesses**. Add an optional `customer_business_profile(user_id, legal_name, gstin, address)` so invoices can show GSTIN (B2B input credit). GST treatment for creator services needs a **CA decision** (extends doc 07 B2).
- Usage-rights terms are part of the contract snapshot. Paid-ads usage beyond the package is a dispute reason.

---

## Part C — Keeping bookings and payments in the app

### C1. Why people leave, and how successful platforms respond
Marketplace leakage happens when buyers and sellers meet on the platform and then transact off it to avoid fees. The most effective fix is giving both sides **more value in the transaction than the fee costs**; heavy-handed communication blocking tends to backfire (Sharetribe, "How to prevent marketplace leakage", updated 2026).

| Lever | Who uses it (pattern) | QuickServe decision |
|---|---|---|
| Payment protection / guarantee only for in-app jobs | Upwork (payment protection), Urban Company (warranty), Airbnb (AirCover) | **Have** (7-day guarantee, doc 03 §6). Extend per vertical: event no-show guarantee = full refund **plus** help finding a replacement; deliverables guarantee for creators |
| Reviews and ranking only from in-app jobs | Universal | **Have.** Make it visible: "Only verified bookings can review" |
| Contact masking until booking or advance | Thumbtack, Urban Company, Upwork (pre-contract) | **Have** for chat; extend to bios, captions and links (§B3); masked calling (roadmap) |
| Lower fee for repeat clients | Fresha-style "new client fee once, then 0%"; Upwork's former sliding fee | **Adopt (C3)**: repeat-client discount on commission |
| Business tools for providers (calendar, CRM, quotes, invoices, payment links) | Fresha, Booksy, Urban Company partner app | **Adopt (C4)**: QuickServe Pro tools. Bring-your-own-client bookings at a low fee |
| Customer rewards for paying in-app | CRED coins, Swiggy/Zomato cashback, UC credits | **Adopt (C2)**: Seva Coins |
| Leakage detection and graduated enforcement | Upwork, Fiverr (ToS + detection) | **Adopt (C5)**, soft first |
| Charge for the lead instead of the transaction | Thumbtack, JustDial, Sulekha | **Optional (C6)**, only for high-ticket proposal categories |

### C2. Seva Coins (customer loyalty)
Name: placeholder, aligned with the brand decision (doc 07 B4).

**Rules (PM decisions; founder may override):**

| Rule | Value | Why |
|---|---|---|
| Value | 1 coin = ₹1 off a future booking | Simple, unlike low-value points (CRED coins are widely seen as low real value) |
| Earn | **2%** of the in-app paid service value (excluding platform fee, taxes and coin-paid portion). Rounded down. Credited **after the booking closes** (dispute window passed) | Rewards completed in-app jobs only; nothing earned on refunded amounts |
| Bonus earns | +25 for a review with a photo; +100 for a referral's first completed booking (and +100 for the referred user); +2% extra (4%) on the first 3 bookings | Drives reviews, referrals and early habit |
| Redeem | Up to **10%** of the next booking's service value, **and never more than that booking's platform revenue** (commission + platform fee net of GST) | Platform-funded, so the provider's payout is unchanged and the Route transfer never exceeds the payment |
| Expiry | 6 months from credit (FIFO). Reminder 15 days before expiry | Limits liability; industry norm |
| Nature | Not cash, not transferable, not withdrawable, no interest; closed-loop on QuickServe only. Can't be bought | Stays a loyalty discount rather than a stored-value instrument. **CA/legal to confirm** RBI PPI and GST position (CBIC Circular 243 on vouchers) |
| Caps | Earning cap 1,000 coins per month per user; redemption at most once per booking | Abuse control |
| Clawback | Coins earned from a booking later refunded or disputed are reversed (the balance can't go negative; any shortfall is deducted from future earns) | Fraud control |

**Data and money:**
- `coin_ledger(id, user_id, delta int, kind ('earn','bonus','redeem','expire','clawback','admin'), booking_id null, expires_at null, ref text unique, created_at)`. The balance is the sum of the ledger in a view. All writes go through security-definer RPCs; there are no client inserts.
- `ref` is unique for idempotency (e.g. `earn:<booking_id>`).
- Redemption adds a `discount` quote line (doc 07 C4) with `funded_by='platform'`. Commission and provider entitlement are computed on the **pre-discount** amount. The platform's revenue on that booking = commission + fee − coin discount (must be ≥ 0, enforced by the cap). The customer's payment is reduced by the coin amount.
- Cron `expire-coins` runs daily. An admin adjustment RPC is audited.
- App: coin balance on the Me tab, a "Use ₹X coins" toggle in checkout (default on), coin history, "You'll earn X coins" on the booking summary and after completion.
- Accounting: track unredeemed coins as a liability (expected redemption rate), with breakage on expiry. CA to define the treatment.

**Membership (later, after coins show retention):** "QuickServe Plus", ₹199 per 3 months: platform fee waived, +2% coins, priority support (the Urban Company Plus pattern). Not built in this plan.

### C3. Provider incentives to stay in the app
- **Repeat-client commission discount:** for the same customer + provider pair, the 2nd and later bookings within 12 months pay **commission − 4 points** (e.g. 12% → 8%; floor 5%). This removes the main reason to take repeat customers offline. Implement in `_commission_bp` using the doc 07 C4 precedence: repeat discount applies after the tier, before the cap.
- **Payout speed:** next-day payouts for providers with a 95%+ in-app completion rate (when the rail allows).
- **Ranking boost:** reliability and in-app completion are part of the match score (§A4).
- **Guarantee for providers:** protection against customer no-shows and cancellations (the policy pays them per doc 07 §3.8), which only applies to in-app bookings.

### C4. QuickServe Pro tools (provider business tools)
Make the app the provider's business system, so moving a client offline loses convenience:
1. Calendar with availability (built in 0009), reminders, and an iCal export.
2. Client list (customers they served in-app, with masked contact; rebook in one tap).
3. **Bring your own client:** the provider creates a booking and payment link for an offline client inside the app. Fee: **3%** payment-processing-plus-tools fee, no commission. The client gets the guarantee, invoice and reviews. This turns off-app clients into in-app transactions at low cost.
4. Quote and invoice generator with GST fields; payment reminders for milestones (doc 07 C6).
5. Public profile page (web) with a "Book on QuickServe" button. Providers share it on Instagram instead of their phone number.

### C5. Detection and enforcement (soft first)
- **Signals:**
  - chat and bio regex/NLP for phone numbers, emails, UPI IDs and phrases like "pay directly", "WhatsApp me";
  - pairs whose first booking completed and then stop booking while both stay active (a repeat-offline pattern);
  - high cancellation after the visit or inspection;
  - a provider's in-app share falling.
- **Responses:**
  1. Inline nudge in chat: "Payments outside QuickServe aren't covered by the guarantee."
  2. Provider warning.
  3. Ranking reduction.
  4. Suspension for repeated, evidenced cases (admin decision, audited).

  **Never auto-suspend.**
- Store signals in `leakage_signals(subject_id, kind, booking_id, details, created_at)`, admin-only.

### C6. Revenue when transactions still happen outside the app
Ordered by fit:

| Stream | Model | When to turn on |
|---|---|---|
| **Pro subscription** for providers | ₹299–₹999/month: more visibility slots (clearly labelled), lower commission (−2 points), advanced tools (C4), analytics | After 3 months of supply in a city |
| **Sponsored listings** | "Sponsored" label, at most 1 per results page, must still pass eligibility and the need-match threshold; cost per click or a daily fee | After demand is steady |
| **Lead fee (proposal categories only)** | Provider pays to send a proposal to a request (Thumbtack/Sulekha pattern), refunded if the customer never views it | Only if in-app conversion of proposals stays below 30% after 90 days (doc 07 D5) |
| **Bring-your-own-client fee** | 3% (C4) | With Pro tools |
| **Financing / EMI commission** | Partner commission on wedding/event EMIs | Phase 3+ |
| **Insurance add-ons** | Damage cover for repairs, event cancellation cover; referral commission | Later, with an IRDAI-registered partner |
| **B2B creator campaigns** | Managed campaigns for local brands (multiple creators): 10–15% management fee | After the creator supply exists |

**Not doing:** selling customer data, contact unlock fees that hand over phone numbers, and unlabelled paid ranking.

---

## Part D — Implementation tasks (execute in order; doc 07 §8 rules apply)

Each task has a **Do** and a **Done when**. Payment, RLS, migrations and AI-tool tasks are review-gated.

**Phase M1: Attributes, tags, links (data foundations)**
- **M1.1** Migration: `categories.profile_schema`, `categories.review_tags`, `provider_services.attributes`, `reviews.tags`, `provider_links`, `customer_business_profile`, `service_packages` price-type fields (if `service_packages` doesn't exist yet, add these fields to doc 07 T1.3 instead). Add `_validate_schema` shared with intake.
  - Done when: SQL tests show invalid attributes or tags are rejected, links RLS works (owner write; public read only when live), and existing tests stay green.
- **M1.2** Seed config for current categories: attribute schemas and review tags for AC repair, electrician, plumber, cleaning, pest control. **Config data only**, written as a migration, not seed.
  - Done when: `get_catalog` returns them, and the app renders the SchemaForm in "My services".
- **M1.3** App: provider attribute editor, links editor with URL validation, review tag chips, and public profile sections ("Specialities", "What customers mention", "Links").
  - Done when: jest + CI pass, and the e2e edits attributes and links as a fresh provider.

**Phase M2: Match engine and review insights**
- **M2.1** `match_providers` RPC (§A4) with weights in `app_config`; SQL tests with fixed fixtures that compute expected scores by hand (no copying outputs as expectations).
- **M2.2** `review-insights` Edge Function + cron + `review_insights` table/view; mocked Gemini tests in CI; live run on seed reviews (report output).
- **M2.3** AI assistant: needs extraction, `match_providers` tool, evidence citation, three tiers, policy bump; deterministic tests (§A6.6).
  - Done when: a live scenario "makeup artist for oily skin" (after M5 seeds a test makeup category in **dev only**, or use AC repair with "inverter AC expert") returns labelled tiers with evidence matching DB rows.

**Phase M3: Travel requests**
- **M3.1** Travel fields + `travel_requests` + RPCs (`create_travel_request`, `respond_travel_request`, expiry cron) + `create_booking` enforcement + `travel` quote line.
  - Done when: SQL tests show a booking beyond the radius without approval is rejected, one with approval succeeds once, and expired or used requests are rejected.
- **M3.2** App: provider travel settings, travel-request inbox, customer "Request availability" flow, notifications via the 0007 outbox; AI `draft_kind: travel_request`.

**Phase M4: Seva Coins**
- **M4.1** `coin_ledger`, balance view, earn-on-close hook (in the payout finalisation path), redeem in checkout (discount line, cap rule), clawback on refund, expiry cron, admin adjust RPC.
  - Done when: SQL tests cover earn (idempotent), redeem cap (≤ 10% and ≤ platform revenue), provider payout unchanged, clawback, expiry FIFO; and the doc 03 worked example with a ₹50 coin redemption shows the provider still gets ₹1,937.60.
- **M4.2** App: balance, checkout toggle, history, earn messaging; analytics events `coins_earned`, `coins_redeemed`.

**Phase M5: Creator and event categories**
Depends on doc 07 Phase 1 (packages) and Phase 3 (proposals, deliverables).
- **M5.1** Category config for B1/B3 (schemas, review tags, packages templates, docs), all `live=false`.
- **M5.2** Instagram and YouTube connect (OAuth Edge Functions, encrypted tokens, daily stats sync, manual fallback). **Blocked on founder:** Meta app review and Google OAuth verification.
- **M5.3** Package cards with deliverables and usage rights; range/from/quote → proposal; B2B business profile and GSTIN on invoices.
- **M5.4** Launch per category via the doc 07 §6.4 checklist (supply minimums, CA tax matrix, verification).

**Phase M6: Leakage programme**
- **M6.1** Repeat-client commission discount (review-gated).
- **M6.2** Bring-your-own-client bookings (provider-created booking + payment link; 3% fee path).
- **M6.3** Leakage signals + chat nudges + admin view.
- **M6.4** Pro subscription and sponsored listings: **design only** in this phase. Build after the doc 07 Phase 5 launches show demand.

---

## Part E — Decisions (PM defaults, 2026-11-14; founder may override)

| # | Decision | Default |
|---|---|---|
| E1 | Show farther providers | Yes, as tier 3, only with provider-set max travel distance, a visible fee, and provider approval before booking |
| E2 | Review evidence quotes | Shown (anonymised, ≤ 140 chars, PII-redacted); counts always shown |
| E3 | Coins earn / redeem / expiry | 2% earn on close, 10% redeem cap (and ≤ platform revenue), 6-month expiry |
| E4 | Repeat-client commission | −4 points for the same pair within 12 months, floor 5% |
| E5 | Bring-your-own-client fee | 3%, no commission |
| E6 | Lead fees | Off; proposal categories only, after the 90-day test (doc 07 D5) |
| E7 | Social stats | Show only verified (OAuth) stats as numbers; self-reported stats labelled |
| E8 | Contact info in profiles and links | Never; links are portfolio only |

**Founder actions:**
1. Meta developer app + Instagram Login app review.
2. Google OAuth verification for YouTube.
3. CA: coins accounting, GST on discounts and creator services, RBI PPI position.
4. Legal: ASCI disclosure terms; creator usage-rights template.
5. Provider agreement update (anti-circumvention clause, repeat-client terms).
