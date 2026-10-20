/**
 * Deterministic seed data for demo mode: Vijayawada-based providers, customer bookings in every interesting
 * state, and a provider-side inbox for the demo user. Amounts are integer paise like the real backend.
 */
import { commissionRateBp, providerPayout, quoteSubtotals, requiredTotal, PLATFORM_FEE_PAISE } from '../money';
import type {
  Booking,
  BookingEvent,
  BookingStatus,
  Category,
  Message,
  Payment,
  Payout,
  Profile,
  Provider,
  ProviderService,
  Quote,
  QuoteItemKind,
  RateUnit,
  Review,
  SkillLevel,
} from '../types';

export const DEMO_USER_ID = 'demo-user';
export const DEMO_OTP = '123456';
/** Customer codes for jobs where the demo user is the provider (so the provider flow can be tried end-to-end). */
export const DEMO_PROVIDER_START_CODE = '1234';
export const DEMO_PROVIDER_END_CODE = '4321';
export const DEMO_ORIGIN = { lat: 16.4995, lng: 80.656 }; // Benz Circle, Vijayawada

export interface DemoAddress {
  area: string;
  line1: string;
  lat: number;
  lng: number;
}

export interface DemoSecrets {
  start_otp: string;
  end_otp: string | null;
  start_attempts: number;
  end_attempts: number;
}

export type DemoProvider = Provider & { lat: number; lng: number };
export type DemoBooking = Booking & { address: DemoAddress; secrets: DemoSecrets };

export interface DemoDb {
  profiles: Profile[];
  categories: Category[];
  providers: DemoProvider[];
  services: ProviderService[];
  reviews: Review[];
  bookings: DemoBooking[];
  quotes: Quote[];
  payments: Payment[];
  payouts: Payout[];
  events: BookingEvent[];
  messages: Message[];
}

const CATEGORIES: [string, string, string][] = [
  ['ac-repair', 'AC Repair', 'snowflake'],
  ['electrician', 'Electrician', 'zap'],
  ['plumber', 'Plumber', 'droplet'],
  ['house-cleaning', 'House Cleaning', 'home'],
  ['water-tank-cleaning', 'Water Tank Cleaning', 'database'],
  ['car-mechanic', 'Car Mechanic', 'truck'],
  ['bike-mechanic', 'Bike Mechanic', 'bike'],
  ['appliance-repair', 'Appliance Repair', 'tv'],
  ['pest-control', 'Pest Control', 'bug'],
  ['carpenter', 'Carpenter', 'hammer'],
  ['painter', 'Painter', 'brush'],
];

interface ProviderSeed {
  id: string;
  name: string;
  bio: string;
  rating: number;
  count: number;
  jobs: number;
  years: number;
  online: boolean;
  languages: string[];
  dLat: number;
  dLng: number;
  services: {
    slug: string;
    level: SkillLevel;
    visit: number;
    labour: number;
    unit: RateUnit;
    rates?: [string, number][];
  }[];
}

const PROVIDERS: ProviderSeed[] = [
  {
    id: 'p-ravi',
    name: 'Ravi Kumar',
    bio: 'Split & window AC specialist. Daikin and Voltas trained. I always show you the faulty part and the bill.',
    rating: 4.8,
    count: 212,
    jobs: 340,
    years: 6,
    online: true,
    languages: ['Telugu', 'Hindi', 'English'],
    dLat: 0.006,
    dLng: 0.008,
    services: [
      {
        slug: 'ac-repair',
        level: 'expert',
        visit: 199,
        labour: 350,
        unit: 'hour',
        rates: [
          ['Jet service (split)', 599],
          ['Gas refill (1.5T split)', 2500],
          ['Capacitor replacement', 450],
          ['Installation (split)', 1499],
        ],
      },
      { slug: 'appliance-repair', level: 'skilled', visit: 149, labour: 300, unit: 'hour', rates: [['Fridge gas refill', 1800]] },
    ],
  },
  {
    id: 'p-suresh',
    name: 'Suresh Anand',
    bio: 'Quick AC servicing and repairs across Vijayawada. Weekend slots available.',
    rating: 4.6,
    count: 88,
    jobs: 120,
    years: 3,
    online: true,
    languages: ['Telugu', 'English'],
    dLat: -0.012,
    dLng: 0.016,
    services: [{ slug: 'ac-repair', level: 'skilled', visit: 149, labour: 299, unit: 'job', rates: [['Jet service (split)', 499]] }],
  },
  {
    id: 'p-cooltech',
    name: 'CoolTech Services',
    bio: 'Certified HVAC team for homes and offices. Warranty on every repair.',
    rating: 4.9,
    count: 31,
    jobs: 45,
    years: 9,
    online: false,
    languages: ['Telugu', 'Hindi', 'English'],
    dLat: 0.028,
    dLng: -0.021,
    services: [
      {
        slug: 'ac-repair',
        level: 'certified',
        visit: 249,
        labour: 450,
        unit: 'hour',
        rates: [
          ['Deep chemical wash', 1199],
          ['PCB repair', 2200],
        ],
      },
    ],
  },
  {
    id: 'p-imran',
    name: 'Imran Shaikh',
    bio: 'House wiring, MCB/DB work, fans, lights and inverter setup. Safety first, neat work.',
    rating: 4.7,
    count: 164,
    jobs: 410,
    years: 8,
    online: true,
    languages: ['Hindi', 'Telugu', 'Urdu'],
    dLat: -0.004,
    dLng: -0.009,
    services: [
      {
        slug: 'electrician',
        level: 'expert',
        visit: 149,
        labour: 300,
        unit: 'hour',
        rates: [
          ['Ceiling fan installation', 249],
          ['MCB replacement', 199],
          ['Inverter installation', 699],
        ],
      },
    ],
  },
  {
    id: 'p-venkat',
    name: 'Venkatesh Rao',
    bio: 'Licensed electrical contractor. Panel upgrades, earthing and full-home rewiring.',
    rating: 4.9,
    count: 58,
    jobs: 96,
    years: 12,
    online: false,
    languages: ['Telugu', 'English'],
    dLat: 0.019,
    dLng: 0.012,
    services: [
      { slug: 'electrician', level: 'certified', visit: 199, labour: 400, unit: 'hour', rates: [['Earthing check', 499]] },
      { slug: 'appliance-repair', level: 'expert', visit: 199, labour: 350, unit: 'hour' },
    ],
  },
  {
    id: 'p-farhan',
    name: 'Farhan Ali',
    bio: 'Leak fixing, bathroom fittings, motor and pipeline work. Same-day visits.',
    rating: 4.5,
    count: 143,
    jobs: 260,
    years: 5,
    online: true,
    languages: ['Hindi', 'Telugu'],
    dLat: 0.009,
    dLng: -0.004,
    services: [
      {
        slug: 'plumber',
        level: 'expert',
        visit: 129,
        labour: 250,
        unit: 'hour',
        rates: [
          ['Tap replacement', 199],
          ['Flush tank repair', 349],
        ],
      },
    ],
  },
  {
    id: 'p-gopal',
    name: 'Gopal Reddy',
    bio: 'Affordable plumbing for apartments. Blockages cleared fast.',
    rating: 4.3,
    count: 37,
    jobs: 58,
    years: 2,
    online: true,
    languages: ['Telugu'],
    dLat: -0.017,
    dLng: -0.006,
    services: [{ slug: 'plumber', level: 'skilled', visit: 99, labour: 199, unit: 'hour' }],
  },
  {
    id: 'p-lakshmi',
    name: 'Lakshmi Cleaners',
    bio: 'Trained, background-verified team. Eco-friendly products. Deep cleaning, kitchens and sofas.',
    rating: 4.7,
    count: 96,
    jobs: 180,
    years: 4,
    online: true,
    languages: ['Telugu', 'English'],
    dLat: 0.014,
    dLng: 0.004,
    services: [
      {
        slug: 'house-cleaning',
        level: 'expert',
        visit: 99,
        labour: 2499,
        unit: 'job',
        rates: [
          ['2BHK deep cleaning', 3499],
          ['Kitchen deep cleaning', 1499],
          ['Sofa shampoo (5 seats)', 999],
        ],
      },
      { slug: 'water-tank-cleaning', level: 'skilled', visit: 99, labour: 799, unit: 'job' },
    ],
  },
  {
    id: 'p-anitha',
    name: 'Anitha Home Services',
    bio: 'Regular and move-in cleaning. Women-led team.',
    rating: 4.4,
    count: 52,
    jobs: 77,
    years: 3,
    online: false,
    languages: ['Telugu', 'Tamil'],
    dLat: -0.022,
    dLng: 0.011,
    services: [{ slug: 'house-cleaning', level: 'skilled', visit: 99, labour: 1999, unit: 'job', rates: [['Bathroom cleaning', 499]] }],
  },
  {
    id: 'p-aqua',
    name: 'AquaPure Tank Care',
    bio: 'Mechanised 6-stage tank cleaning with UV treatment. Overhead and sump tanks.',
    rating: 4.8,
    count: 77,
    jobs: 150,
    years: 6,
    online: true,
    languages: ['Telugu', 'Hindi'],
    dLat: 0.003,
    dLng: 0.021,
    services: [
      {
        slug: 'water-tank-cleaning',
        level: 'certified',
        visit: 149,
        labour: 999,
        unit: 'job',
        rates: [
          ['Overhead tank (1000 L)', 899],
          ['Sump (5000 L)', 1599],
        ],
      },
    ],
  },
  {
    id: 'p-mohan',
    name: 'Mohan Auto Works',
    bio: 'Doorstep car servicing, battery and brake work. Maruti, Hyundai, Tata, Honda.',
    rating: 4.6,
    count: 120,
    jobs: 230,
    years: 10,
    online: true,
    languages: ['Telugu', 'English'],
    dLat: -0.008,
    dLng: 0.019,
    services: [
      { slug: 'car-mechanic', level: 'expert', visit: 249, labour: 450, unit: 'hour', rates: [['General service (hatchback)', 2999]] },
      { slug: 'bike-mechanic', level: 'skilled', visit: 99, labour: 199, unit: 'hour' },
    ],
  },
  {
    id: 'p-kiran',
    name: 'Kiran Bike Care',
    bio: 'Two-wheeler servicing at your doorstep. Puncture, chain, clutch and electrical.',
    rating: 4.5,
    count: 210,
    jobs: 520,
    years: 7,
    online: true,
    languages: ['Telugu', 'Hindi'],
    dLat: 0.011,
    dLng: -0.015,
    services: [
      {
        slug: 'bike-mechanic',
        level: 'expert',
        visit: 99,
        labour: 199,
        unit: 'hour',
        rates: [
          ['General service', 699],
          ['Puncture repair', 99],
        ],
      },
    ],
  },
  {
    id: 'p-pestshield',
    name: 'PestShield India',
    bio: 'Government-approved chemicals. Cockroach, termite and bed-bug treatment with 90-day warranty.',
    rating: 4.7,
    count: 64,
    jobs: 110,
    years: 8,
    online: false,
    languages: ['Telugu', 'English'],
    dLat: 0.025,
    dLng: 0.006,
    services: [
      { slug: 'pest-control', level: 'certified', visit: 199, labour: 1299, unit: 'job', rates: [['2BHK cockroach treatment', 1199]] },
    ],
  },
  {
    id: 'p-raju',
    name: 'Raju Carpenter',
    bio: 'Furniture repair, modular kitchen fixes, door locks and custom shelves.',
    rating: 4.6,
    count: 45,
    jobs: 88,
    years: 11,
    online: true,
    languages: ['Telugu'],
    dLat: -0.013,
    dLng: 0.002,
    services: [{ slug: 'carpenter', level: 'expert', visit: 149, labour: 300, unit: 'hour', rates: [['Door lock fitting', 299]] }],
  },
  {
    id: 'p-colourcraft',
    name: 'ColourCraft Painters',
    bio: 'Interior and exterior painting with Asian Paints and Berger. Free colour consultation.',
    rating: 4.5,
    count: 29,
    jobs: 40,
    years: 5,
    online: false,
    languages: ['Telugu', 'Hindi'],
    dLat: 0.031,
    dLng: 0.024,
    services: [{ slug: 'painter', level: 'skilled', visit: 199, labour: 18, unit: 'job', rates: [['1BHK repaint', 9999]] }],
  },
];

const CUSTOMERS: [string, string][] = [
  ['c-sneha', 'Sneha Iyer'],
  ['c-rahul', 'Rahul Verma'],
  ['c-divya', 'Divya Nair'],
  ['c-karthik', 'Karthik Subramanian'],
  ['c-meera', 'Meera Joshi'],
  ['c-arjun', 'Arjun Patel'],
  ['c-pooja', 'Pooja Kulkarni'],
  ['c-vikram', 'Vikram Singh'],
  ['c-ananya', 'Ananya Rao'],
  ['c-nikhil', 'Nikhil Menon'],
];

const REVIEW_TEXTS = [
  'Came in 30 mins, showed me the faulty part and the bill. Fair price.',
  'Very professional and polite. Cleaned up after the work too.',
  'Explained the problem clearly before starting. Will book again.',
  'Quick and neat work. Price was exactly as quoted in the app.',
  'Arrived on time and finished faster than expected.',
  'Good work, but came 15 minutes late.',
  'Fixed an issue two other technicians could not. Highly recommend!',
  'Honest about what needed replacing and what did not.',
  'Courteous, wore shoe covers and was careful with the furniture.',
  'Reasonable rates and good quality spare parts.',
  'Did the job well. Communication on chat was quick.',
  null,
];

const SCORE_PATTERNS = [5, 5, 4, 5, 5, 4, 5, 3, 5, 4, 5, 5];

const AREAS = ['Benz Circle', 'Labbipet', 'Gurunanak Colony', 'Patamata', 'Moghalrajpuram', 'Governorpet', 'Auto Nagar'];

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

const hash = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** Next full hour between 9:00 and 19:00 at/after the given time. */
const roundToSlot = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  if (d.getHours() < 9) d.setHours(10);
  if (d.getHours() > 19) {
    d.setDate(d.getDate() + 1);
    d.setHours(10);
  }
  return d.toISOString();
};

export function buildSeed(now = Date.now()): DemoDb {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const rupees = (r: number) => Math.round(r * 100);

  const categories: Category[] = CATEGORIES.map(([slug, name, icon], i) => ({
    id: `cat-${slug}`,
    slug,
    name,
    icon,
    pricing_mode: 'quote',
    sort_order: i + 1,
  }));
  const catBySlug = (slug: string) => categories.find((c) => c.slug === slug)!;

  const profiles: Profile[] = [
    {
      id: DEMO_USER_ID,
      full_name: 'Aarav Mehta',
      avatar_url: null,
      role_customer: true,
      role_provider: true,
      created_at: ago(140 * DAY),
    },
    ...PROVIDERS.map((p, i) => ({
      id: p.id,
      full_name: p.name,
      avatar_url: null,
      role_customer: true,
      role_provider: true,
      created_at: ago((200 + i * 30) * DAY),
    })),
    ...CUSTOMERS.map(([id, name], i) => ({
      id,
      full_name: name,
      avatar_url: null,
      role_customer: true,
      role_provider: false,
      created_at: ago((60 + i * 9) * DAY),
    })),
  ];

  const providers: DemoProvider[] = [];
  const services: ProviderService[] = [];
  const reviews: Review[] = [];

  const addProvider = (p: ProviderSeed, createdDaysAgo: number) => {
    providers.push({
      id: p.id,
      bio: p.bio,
      city: 'Vijayawada',
      service_radius_km: 15,
      years_experience: p.years,
      languages: p.languages,
      kyc_status: 'verified',
      suspended: false,
      is_online: p.online,
      rating_avg: p.rating,
      rating_count: p.count,
      jobs_completed: p.jobs,
      commission_tier: 10,
      razorpay_account_id: `acc_demo_${p.id}`,
      created_at: ago(createdDaysAgo * DAY),
      lat: DEMO_ORIGIN.lat + p.dLat,
      lng: DEMO_ORIGIN.lng + p.dLng,
    });
    p.services.forEach((s, si) => {
      const id = `ps-${p.id.slice(2)}-${s.slug}`;
      services.push({
        id,
        provider_id: p.id,
        category_id: catBySlug(s.slug).id,
        skill_level: s.level,
        visit_fee: rupees(s.visit),
        labour_rate: rupees(s.labour),
        rate_unit: s.unit,
        active: true,
        rate_card_items: (s.rates ?? []).map(([title, price], ri) => ({
          id: `${id}-r${ri}`,
          provider_service_id: id,
          title,
          price: rupees(price),
        })),
      });
      void si;
    });
  };

  PROVIDERS.forEach((p, pi) => {
    addProvider(p, 400 + pi * 20);
    const n = 6 + (pi % 5);
    for (let r = 0; r < n; r++) {
      const base = SCORE_PATTERNS[(r + pi) % SCORE_PATTERNS.length]!;
      const rating = p.rating >= 4.75 ? Math.max(base, 4) : base;
      const sub = (d: number) => Math.min(5, Math.max(3, rating + d));
      const [cid] = CUSTOMERS[(r + pi * 3) % CUSTOMERS.length]!;
      reviews.push({
        id: `rv-${p.id}-${r}`,
        booking_id: `hist-${p.id}-${r}`,
        customer_id: cid,
        provider_id: p.id,
        rating,
        punctuality: sub(r % 3 === 0 ? -1 : 0),
        quality: sub(0),
        behaviour: sub(r % 4 === 1 ? 0 : 0),
        pricing: sub(r % 2 === 0 ? -1 : 0),
        comment: REVIEW_TEXTS[(r * 5 + pi) % REVIEW_TEXTS.length] ?? null,
        provider_reply: r === 0 ? 'Thank you! Happy to help anytime.' : null,
        created_at: ago((r * 9 + 2 + pi) * DAY),
      });
    }
  });

  // The demo user is also a verified provider (Electrician + Appliance repair) for provider mode.
  addProvider(
    {
      id: DEMO_USER_ID,
      name: 'Aarav Mehta',
      bio: 'Electrician with 7 years of experience in home wiring, appliances and inverter installs.',
      rating: 4.8,
      count: 57,
      jobs: 64,
      years: 7,
      online: true,
      languages: ['Telugu', 'Hindi', 'English'],
      dLat: -0.002,
      dLng: 0.003,
      services: [
        {
          slug: 'electrician',
          level: 'expert',
          visit: 149,
          labour: 300,
          unit: 'hour',
          rates: [
            ['Ceiling fan installation', 249],
            ['Switchboard repair', 149],
          ],
        },
        { slug: 'appliance-repair', level: 'skilled', visit: 199, labour: 350, unit: 'hour' },
      ],
    },
    140,
  );

  const bookings: DemoBooking[] = [];
  const quotes: Quote[] = [];
  const payments: Payment[] = [];
  const payouts: Payout[] = [];
  const events: BookingEvent[] = [];
  const messages: Message[] = [];
  let eventSeq = 1;

  const FLOW: BookingStatus[] = [
    'pending_payment',
    'requested',
    'accepted',
    'en_route',
    'inspecting',
    'quote_sent',
    'awaiting_payment',
    'in_progress',
    'completion_requested',
    'completed',
    'closed',
  ];

  const pushEvents = (bookingId: string, path: BookingStatus[], startMs: number, stepMs: number) => {
    let from: BookingStatus | null = null;
    path.forEach((to, i) => {
      events.push({ id: eventSeq++, booking_id: bookingId, from_status: from, to_status: to, note: null, at: ago(startMs - i * stepMs) });
      from = to;
    });
  };

  const serviceFor = (providerId: string, slug: string) =>
    services.find((s) => s.provider_id === providerId && s.category_id === catBySlug(slug).id)!;

  const addQuote = (
    bookingId: string,
    version: number,
    status: Quote['status'],
    items: [QuoteItemKind, string, number, number][],
    createdMs: number,
    note: string | null = null,
    isChangeOrder = false,
  ): Quote => {
    const qid = `${bookingId}-q${version}`;
    const lines = items.map(([kind, title, qty, unit], i) => ({
      id: `${qid}-i${i}`,
      quote_id: qid,
      kind,
      title,
      qty,
      unit_price: rupees(unit),
      bill_photo_url: null,
    }));
    const sub = quoteSubtotals(lines.map((l) => ({ kind: l.kind, qty: l.qty, unitPrice: l.unit_price })));
    const q: Quote = {
      id: qid,
      booking_id: bookingId,
      version,
      status,
      is_change_order: isChangeOrder,
      subtotal_labour: sub.labour,
      subtotal_parts: sub.parts,
      subtotal_other: sub.other,
      total: sub.total,
      note,
      created_at: ago(createdMs),
      quote_items: lines,
    };
    quotes.push(q);
    return q;
  };

  const addPayment = (bookingId: string, purpose: Payment['purpose'], amount: number, paidMs: number, quoteId: string | null = null, status: Payment['status'] = 'paid') => {
    payments.push({
      id: `${bookingId}-pay${payments.filter((p) => p.booking_id === bookingId).length + 1}`,
      booking_id: bookingId,
      quote_id: quoteId,
      purpose,
      amount,
      status,
      created_at: ago(paidMs + MIN),
      paid_at: status === 'paid' || status === 'refunded' ? ago(paidMs) : null,
    });
  };

  const addBooking = (o: {
    id: string;
    customer: string;
    provider: string;
    slug: string;
    status: BookingStatus;
    createdMs: number;
    description: string;
    area: string;
    line1: string;
    scheduledInMs?: number | null;
    path?: BookingStatus[];
    startOtp?: string;
    endOtp?: string | null;
  }): DemoBooking => {
    const svc = serviceFor(o.provider, o.slug);
    const flowIdx = FLOW.indexOf(o.status);
    const path = o.path ?? (flowIdx >= 0 ? FLOW.slice(0, flowIdx + 1) : ['pending_payment', o.status]);
    const step = Math.min(Math.max(Math.floor(o.createdMs / (path.length + 1)), MIN), 40 * MIN);
    const acceptedIdx = path.indexOf('accepted');
    const b: DemoBooking = {
      id: o.id,
      customer_id: o.customer,
      provider_id: o.provider,
      category_id: catBySlug(o.slug).id,
      provider_service_id: svc.id,
      description: o.description,
      photos: [],
      scheduled_at: o.scheduledInMs != null ? roundToSlot(now + o.scheduledInMs) : null,
      status: o.status,
      visit_fee: svc.visit_fee,
      platform_fee: PLATFORM_FEE_PAISE,
      approved_quote_id: null,
      total_amount: null,
      commission: null,
      gst_on_commission: null,
      refund_amount: 0,
      cancelled_reason: null,
      created_at: ago(o.createdMs),
      accepted_at: acceptedIdx >= 0 ? ago(o.createdMs - acceptedIdx * step) : null,
      completion_requested_at: null,
      completed_at: null,
      address: {
        area: o.area,
        line1: o.line1,
        lat: DEMO_ORIGIN.lat + ((hash(o.id) % 21) - 10) * 0.0015,
        lng: DEMO_ORIGIN.lng + ((Math.floor(hash(o.id) / 21) % 21) - 10) * 0.0015,
      },
      secrets: { start_otp: o.startOtp ?? '4821', end_otp: o.endOtp ?? null, start_attempts: 0, end_attempts: 0 },
    };
    bookings.push(b);
    pushEvents(b.id, path, o.createdMs, step);
    if (o.status !== 'pending_payment') addPayment(b.id, 'visit_fee', b.visit_fee, o.createdMs - MIN);
    return b;
  };

  const approve = (b: DemoBooking, q: Quote, paidMs: number) => {
    q.status = 'approved';
    b.approved_quote_id = q.id;
    b.total_amount = requiredTotal(q.total, b.visit_fee, b.platform_fee);
    addPayment(b.id, 'balance', b.total_amount - b.visit_fee, paidMs, q.id);
  };

  const demoProviderCreated = new Date(now - 140 * DAY);
  const settle = (b: DemoBooking, q: Quote | null, completedMs: number, transferred: boolean) => {
    const rateBp = commissionRateBp({ jobsCompleted: 64, providerCreatedAt: demoProviderCreated, at: new Date(now - completedMs) });
    const gross = q ? Math.max(q.total, b.visit_fee) : b.visit_fee;
    const commissionable = q ? q.subtotal_labour : b.visit_fee;
    const p = providerPayout({ gross, commissionable, rateBp });
    b.commission = p.commission;
    b.gst_on_commission = p.gst;
    b.completed_at = q ? ago(completedMs) : null;
    payouts.push({
      id: `po-${b.id}`,
      booking_id: b.id,
      gross: p.gross,
      commission: p.commission,
      gst_on_commission: p.gst,
      amount: p.payout,
      status: transferred ? 'transferred' : 'pending',
      release_after: new Date(now - completedMs + DAY).toISOString(),
      created_at: ago(completedMs),
      transferred_at: transferred ? new Date(now - completedMs + DAY + 20 * MIN).toISOString() : null,
    });
  };

  // ---------- Demo user as CUSTOMER ----------
  const b1 = addBooking({
    id: 'QS1042',
    customer: DEMO_USER_ID,
    provider: 'p-ravi',
    slug: 'ac-repair',
    status: 'quote_sent',
    createdMs: 95 * MIN,
    description: 'Split AC in the bedroom is not cooling and makes a rattling noise when it starts.',
    area: 'Benz Circle',
    line1: 'Flat 302, Sai Residency, 4th Lane',
  });
  addQuote(
    b1.id,
    1,
    'sent',
    [
      ['labour', 'Gas refill (1.5T split)', 1, 1500],
      ['part', 'Capacitor 45uF', 1, 650],
    ],
    8 * MIN,
    'Gas pressure is low and the capacitor is weak. Bill photo shared in chat.',
  );
  messages.push(
    { id: 'm1', booking_id: b1.id, sender_id: 'p-ravi', body: "Hi! I'm on my way, will reach in about 20 minutes.", image_url: null, created_at: ago(70 * MIN) },
    { id: 'm2', booking_id: b1.id, sender_id: DEMO_USER_ID, body: 'Great, thanks. The gate code is 1402.', image_url: null, created_at: ago(68 * MIN) },
    {
      id: 'm3',
      booking_id: b1.id,
      sender_id: 'p-ravi',
      body: 'Checked the unit — gas is low and the capacitor is weak. I have sent the quote, please review.',
      image_url: null,
      created_at: ago(8 * MIN),
    },
  );

  addBooking({
    id: 'QS1043',
    customer: DEMO_USER_ID,
    provider: 'p-farhan',
    slug: 'plumber',
    status: 'en_route',
    createdMs: 26 * MIN,
    description: 'Kitchen sink tap is leaking continuously and the pipe below is loose.',
    area: 'Benz Circle',
    line1: 'Flat 302, Sai Residency, 4th Lane',
    startOtp: '4821',
  });
  messages.push({
    id: 'm4',
    booking_id: 'QS1043',
    sender_id: 'p-farhan',
    body: 'Leaving now. Please keep the area under the sink clear.',
    image_url: null,
    created_at: ago(4 * MIN),
  });

  addBooking({
    id: 'QS1045',
    customer: DEMO_USER_ID,
    provider: 'p-aqua',
    slug: 'water-tank-cleaning',
    status: 'requested',
    createdMs: 3 * MIN,
    description: 'Overhead tank (1000 L) cleaning. Water has a slight smell.',
    area: 'Benz Circle',
    line1: 'Flat 302, Sai Residency, 4th Lane',
    scheduledInMs: DAY,
  });

  const b3 = addBooking({
    id: 'QS1039',
    customer: DEMO_USER_ID,
    provider: 'p-lakshmi',
    slug: 'house-cleaning',
    status: 'completed',
    createdMs: 2 * DAY,
    description: '2BHK deep cleaning before Diwali, including kitchen and two bathrooms.',
    area: 'Benz Circle',
    line1: 'Flat 302, Sai Residency, 4th Lane',
  });
  const q3 = addQuote(
    b3.id,
    1,
    'sent',
    [
      ['labour', '2BHK deep cleaning', 1, 3499],
      ['other', 'Cleaning chemicals & equipment', 1, 300],
    ],
    2 * DAY - 2 * 60 * MIN,
  );
  approve(b3, q3, 2 * DAY - 3 * 60 * MIN);
  b3.completed_at = ago(5 * 60 * MIN);

  const b4 = addBooking({
    id: 'QS1031',
    customer: DEMO_USER_ID,
    provider: 'p-imran',
    slug: 'electrician',
    status: 'closed',
    createdMs: 9 * DAY,
    description: 'Two fans not working and one switchboard sparking.',
    area: 'Benz Circle',
    line1: 'Flat 302, Sai Residency, 4th Lane',
  });
  const q4 = addQuote(
    b4.id,
    1,
    'sent',
    [
      ['labour', 'Fan repair (2 nos)', 2, 250],
      ['labour', 'Switchboard rewiring', 1, 350],
      ['part', 'Modular switch + socket', 2, 180],
    ],
    9 * DAY - 90 * MIN,
  );
  approve(b4, q4, 9 * DAY - 2 * 60 * MIN);
  b4.completed_at = ago(9 * DAY - 4 * 60 * MIN);
  reviews.push({
    id: 'rv-demo-1031',
    booking_id: b4.id,
    customer_id: DEMO_USER_ID,
    provider_id: 'p-imran',
    rating: 5,
    punctuality: 5,
    quality: 5,
    behaviour: 5,
    pricing: 4,
    comment: 'Found the loose neutral wire in minutes. Very safe and tidy work.',
    provider_reply: null,
    created_at: ago(8 * DAY),
  });

  const b5 = addBooking({
    id: 'QS1027',
    customer: DEMO_USER_ID,
    provider: 'p-pestshield',
    slug: 'pest-control',
    status: 'cancelled',
    createdMs: 14 * DAY,
    description: 'Cockroach treatment for kitchen and bathrooms.',
    area: 'Benz Circle',
    line1: 'Flat 302, Sai Residency, 4th Lane',
    path: ['pending_payment', 'requested', 'cancelled'],
  });
  b5.cancelled_reason = 'Plans changed';
  b5.refund_amount = b5.visit_fee;
  const p5 = payments.find((p) => p.booking_id === b5.id);
  if (p5) p5.status = 'refunded';

  // ---------- Demo user as PROVIDER ----------
  const provJob = (o: Omit<Parameters<typeof addBooking>[0], 'provider' | 'startOtp' | 'endOtp'>) =>
    addBooking({ ...o, provider: DEMO_USER_ID, startOtp: DEMO_PROVIDER_START_CODE, endOtp: null });

  provJob({
    id: 'QS2101',
    customer: 'c-sneha',
    slug: 'electrician',
    status: 'requested',
    createdMs: 3 * MIN,
    description: 'MCB keeps tripping whenever the geyser is switched on. Need it checked today.',
    area: 'Labbipet',
    line1: 'H.No 12-4-7, Near Ramalayam',
  });
  provJob({
    id: 'QS2102',
    customer: 'c-rahul',
    slug: 'appliance-repair',
    status: 'requested',
    createdMs: 7 * MIN,
    description: 'Front-load washing machine is not draining, shows error E21.',
    area: 'Patamata',
    line1: 'Flat 5B, Krishna Towers',
    scheduledInMs: 18 * 60 * MIN,
  });
  provJob({
    id: 'QS2096',
    customer: 'c-divya',
    slug: 'electrician',
    status: 'inspecting',
    createdMs: 60 * MIN,
    description: 'Install 3 ceiling fans and fix a loose 16A socket in the kitchen.',
    area: 'Gurunanak Colony',
    line1: 'Villa 21, Green Meadows',
  });
  const j4 = provJob({
    id: 'QS2093',
    customer: 'c-karthik',
    slug: 'appliance-repair',
    status: 'in_progress',
    createdMs: 3 * 60 * MIN,
    description: 'Double-door fridge not cooling in the lower compartment.',
    area: 'Moghalrajpuram',
    line1: 'Flat 101, Sri Sai Enclave',
  });
  const q4p = addQuote(
    j4.id,
    1,
    'sent',
    [
      ['labour', 'Thermostat replacement', 1, 450],
      ['part', 'Thermostat (OEM)', 1, 850],
    ],
    2 * 60 * MIN,
  );
  approve(j4, q4p, 110 * MIN);
  messages.push({
    id: 'm5',
    booking_id: j4.id,
    sender_id: 'c-karthik',
    body: 'Payment done. Please go ahead.',
    image_url: null,
    created_at: ago(110 * MIN),
  });

  const history: [string, string, string, number, boolean, [QuoteItemKind, string, number, number][] | null][] = [
    ['QS2090', 'c-meera', 'electrician', 4 * 60 * MIN, false, [['labour', 'Inverter installation', 1, 699], ['part', 'Wiring kit', 1, 420]]],
    ['QS2084', 'c-arjun', 'appliance-repair', 30 * 60 * MIN, false, [['labour', 'Mixer grinder motor rewinding', 1, 550], ['part', 'Carbon brushes', 2, 90]]],
    ['QS2071', 'c-pooja', 'electrician', 3 * DAY, true, [['labour', 'Ceiling fan installation', 3, 249], ['part', 'Fan hooks & clamps', 3, 60]]],
    ['QS2066', 'c-vikram', 'electrician', 5 * DAY, true, [['labour', 'Switchboard repair', 2, 149]]],
    ['QS2058', 'c-ananya', 'appliance-repair', 8 * DAY, true, [['labour', 'Microwave magnetron check', 1, 400], ['part', 'High-voltage fuse', 1, 180]]],
    ['QS2052', 'c-nikhil', 'electrician', 9 * DAY, true, null],
  ];
  history.forEach(([id, customer, slug, completedMs, transferred, items], i) => {
    const isNoWork = items === null;
    const b = provJob({
      id,
      customer,
      slug,
      status: isNoWork ? 'closed_no_work' : transferred ? 'closed' : 'completed',
      createdMs: completedMs + 3 * 60 * MIN,
      description: isNoWork ? 'Geyser not heating.' : `Job #${i + 1} for ${slug}`,
      area: AREAS[i % AREAS.length]!,
      line1: `Door ${10 + i}, Main Road`,
      path: isNoWork ? ['pending_payment', 'requested', 'accepted', 'en_route', 'inspecting', 'quote_sent', 'closed_no_work'] : undefined,
    });
    if (items) {
      b.description = items.map((x) => x[1]).join(', ');
      const q = addQuote(b.id, 1, 'sent', items, completedMs + 2 * 60 * MIN);
      approve(b, q, completedMs + 100 * MIN);
      settle(b, q, completedMs, transferred);
    } else {
      addQuote(b.id, 1, 'rejected', [['labour', 'Heating element replacement', 1, 900]], completedMs + 10 * MIN);
      settle(b, null, completedMs, transferred);
    }
  });

  // Completed customer bookings also generate payouts for their providers (not shown to the demo user).
  settle(b4, q4, 9 * DAY - 4 * 60 * MIN, true);
  b4.completed_at = ago(9 * DAY - 4 * 60 * MIN);
  settle(b3, q3, 5 * 60 * MIN, false);

  return { profiles, categories, providers, services, reviews, bookings, quotes, payments, payouts, events, messages };
}
