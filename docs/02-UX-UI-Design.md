# QuickServe — UX / UI Design Spec

> Clickable visual mockups: open `docs/design/mockups.html` in a browser.
> **Getting it into Figma:** install the free Figma plugin **"html.to.design"** → import `mockups.html`. It converts the HTML screens into editable Figma frames and layers. Or rebuild them by hand from the tokens and wireframes below (about 1 day in Figma, free Starter plan).

## 1. Design principles
1. **Two-tap booking.** Category → provider → Book. No account wall until the booking is confirmed.
2. **Trust is visible.** Verified badge, ★ rating with count, jobs done, and skill level on every provider card.
3. **Money is never a surprise.** Every amount shows its breakdown; nothing is charged without an explicit approval.
4. **Built for the provider's phone.** Big buttons (≥ 48 dp), works in sunlight (high contrast), little typing (steppers and chips), and Hindi-ready.

## 2. Design tokens
| Token | Value | Use |
|---|---|---|
| `primary` | `#1E5EFF` | CTAs, links, active tab |
| `success` | `#12B76A` | Verified, paid, online |
| `warning` | `#F79009` | Pending, quote awaiting |
| `danger` | `#F04438` | Cancel, reject, dispute |
| `text` / `muted` | `#101828` / `#667085` | Body / secondary |
| `bg` / `card` | `#F8FAFC` / `#FFFFFF` | Screen / surfaces |
| Radius | 12 (cards), 999 (chips) | |
| Spacing | 4 · 8 · 12 · 16 · 24 | |
| Type | System font. H1 24/700, H2 18/600, Body 15/400, Caption 12/500 | Respects OS font scale |
| Touch target | min 48 × 48 | |

## 3. Navigation map
```
Launch ─► Login (phone) ─► OTP ─► Role? ──┬─► Customer tabs: [Home] [Bookings] [Profile]
                                          └─► Provider tabs: [Jobs] [Earnings] [Profile]
Home ─► Category list ─► Provider detail ─► Book ─► Pay visit fee ─► Booking detail
Booking detail (shared) = status timeline + OTP + quote + chat + pay + review
```

## 4. Key screens (wireframes)

### 4.1 Customer — Home
```
┌──────────────────────────────┐
│ 📍 Home · Benz Circle ▾   🔔 │
│ ┌──────────────────────────┐ │
│ │ 🔍 Search "AC repair"    │ │
│ └──────────────────────────┘ │
│  What do you need?           │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│ │ ❄️ │ │ ⚡ │ │ 🚰 │ │ 🧹 │  │
│ │ AC │ │Elec│ │Plum│ │Clean│ │
│ └────┘ └────┘ └────┘ └────┘  │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│ │ 💧 │ │ 🚗 │ │ 🛵 │ │ More│ │
│ │Tank│ │Car │ │Bike│ │     │ │
│ └────┘ └────┘ └────┘ └────┘  │
│  ⭐ Top rated near you        │
│ [ProviderCard][ProviderCard]→│
├──────────────────────────────┤
│  🏠 Home   📋 Bookings  👤 Me │
└──────────────────────────────┘
```

### 4.2 Customer — Category results (sort & filter)
```
┌──────────────────────────────┐
│ ← AC Repair         (32 pros)│
│ Sort: [Recommended▾]  ⚙ Filter│
│ (★4+) (Expert) (Online now)   │  ← filter chips
│ ┌──────────────────────────┐ │
│ │ 🧑 Ravi Kumar   ✔Verified │ │
│ │ ★ 4.8 (212) · Expert     │ │
│ │ 1.2 km · 340 jobs · 6 yrs│ │
│ │ Visit ₹199   [ Book ]    │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 🧑 Suresh A.   ✔Verified  │ │
│ │ ★ 4.6 (88) · Skilled     │ │
│ │ ...                      │ │
└──────────────────────────────┘
```

### 4.3 Provider detail
```
┌──────────────────────────────┐
│ ←                         ⋮  │
│        ( photo )             │
│     Ravi Kumar  ✔ Verified   │
│  ★4.8 (212) · 340 jobs · 6y  │
│  Speaks: Telugu, Hindi, Eng  │
│ ─ Services ───────────────── │
│  AC Repair · EXPERT          │
│   Visit ₹199 · Labour ₹350/h │
│   Rate card:                 │
│    Gas refill ......... ₹2,500│
│    Service (split) .... ₹  599│
│  Fridge Repair · SKILLED ... │
│ ─ Reviews ★4.8 ───────────── │
│  Punctual 4.9 Quality 4.8    │
│  "Fixed in 30 min…" – Priya  │
│ ┌──────────────────────────┐ │
│ │      Book Ravi  →        │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### 4.4 Book
```
┌──────────────────────────────┐
│ ← Book AC Repair · Ravi      │
│ What's the problem?          │
│ ┌──────────────────────────┐ │
│ │ AC not cooling, makes... │ │
│ └──────────────────────────┘ │
│ [+ Add photos]               │
│ Address: Home · Flat 302 ▾   │
│ When:  (● ASAP) ( Schedule ) │
│ ─ Price ──────────────────── │
│ Visit / inspection fee  ₹199 │
│ ⓘ Adjusted in the final bill.│
│   You'll approve a quote     │
│   before any work starts.    │
│ Typical total: ₹600–₹2,800   │
│ ┌──────────────────────────┐ │
│ │   Pay ₹199 & Book        │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### 4.5 Booking detail — customer approving a quote
```
┌──────────────────────────────┐
│ ← Booking #QS1042            │
│ ●──●──●──◉──○──○             │
│ Req Acc Arr Quote Work Paid  │
│ Start code: 4 8 2 1  (share  │
│   only when Ravi arrives)    │
│ ─ Quote v1 (awaiting you) ── │
│ Labour  Gas refill    ₹1,500 │
│ Part    Capacitor 45uF ₹ 650 │
│          [📷 view bill]       │
│ Platform fee            ₹ 29 │
│ Visit fee paid         −₹199 │
│ ────────────────────────────  │
│ Pay now to start work ₹1,980 │
│ [ Reject ]  [Approve & Pay ✔]│
│ 💬 Chat with Ravi            │
│ (Completion code appears only│
│  after Ravi marks work done) │
└──────────────────────────────┘
```

### 4.6 Provider — Jobs dashboard
```
┌──────────────────────────────┐
│ Hi Ravi       [● ONLINE ]    │
│ Today ₹2,340 · 3 jobs        │
│ ─ New request (expires 12:41)│
│ ┌──────────────────────────┐ │
│ │ AC Repair · 1.4 km       │ │
│ │ "AC not cooling…" 📷x2    │ │
│ │ ASAP · Visit ₹199        │ │
│ │ [Decline]   [ Accept ]   │ │
│ └──────────────────────────┘ │
│ ─ Active ─────────────────── │
│  #QS1039 Arrived → Send quote│
├──────────────────────────────┤
│ 🧰 Jobs   💰 Earnings  👤 Me  │
└──────────────────────────────┘
```

### 4.7 Provider — Quote editor
```
┌──────────────────────────────┐
│ ← Quote for #QS1042          │
│ (Labour)(Part)(Other)  + Add │
│ ┌──────────────────────────┐ │
│ │ Labour · Gas refill      │ │
│ │ Qty [-] 1 [+]  ₹ [1500]  │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Part · Capacitor 45uF    │ │
│ │ Qty [-] 1 [+]  ₹ [650]   │ │
│ │ [📷 Attach bill]          │ │
│ └──────────────────────────┘ │
│ Total ₹2,150                 │
│ You receive ₹1,937.60        │
│  (₹2,150 − ₹180 commission   │
│   − ₹32.40 GST on commission;│
│   before statutory TDS/TCS)  │
│ ┌──────────────────────────┐ │
│ │   Send to customer  →    │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### 4.8 Review
```
★ ★ ★ ★ ☆   How was Ravi?
Punctuality ★★★★★  Quality ★★★★☆
Behaviour   ★★★★★  Fair price ★★★★☆
[ Tell others about your experience… ]
[+ photos]            [ Submit ]
```

## 5. Empty, error, and edge states
| Situation | UX |
|---|---|
| No providers in category | "No pros nearby yet. Notify me when available" + suggest widening the radius |
| Provider didn't respond in 15 min | Auto-refund the visit fee + show 3 alternative pros |
| Payment failed | Keep the booking in `pending_payment` for 30 min with a "Retry payment" button |
| Quote is above the typical range | Yellow banner "This is higher than usual for this job, ask Ravi why before approving" |
| Offline | Cached booking view, a "You're offline" bar, chat queued |

## 6. Accessibility & localization
- All icons have text labels; stars include an accessibilityLabel ("Rated 4.8 out of 5 from 212 reviews").
- Strings live in an i18n file from day 1 (`en`, `hi`); allow +30% text length.
- Currency is always `₹1,234` (en-IN grouping) via `Intl.NumberFormat('en-IN')`.
