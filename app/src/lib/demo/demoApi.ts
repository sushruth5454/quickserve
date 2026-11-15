/**
 * In-memory implementation of the Api contract for demo mode. State transitions mirror the SQL RPCs in
 * supabase/migrations/0001_init.sql (same guards, same money math via money.ts) so the UI behaves as it would
 * against the real backend. Payments are simulated: createPayment() returns a demo:// link and the payment
 * sheet calls completeDemoPayment(), the equivalent of the Razorpay webhook.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Api,
  AuthSession,
  Coords,
  CreateBookingInput,
  PaymentLinkResponse,
  ProviderDetail,
  ProviderProfileInput,
  ProviderServiceWithProvider,
  ServiceInput,
  TopRatedProvider,
} from '../apiTypes';
import { commissionRateBp, providerPayout, quoteSubtotals, requiredTotal } from '../money';
import { coinRedemptionLimit, type CoinLedgerEntry, type CoinRedemptionPreview } from '../coins';
import type {
  Booking,
  BookingStatus,
  Message,
  NewAddressInput,
  OtpResult,
  Payment,
  Provider,
  ProviderJob,
  ProviderSearchResult,
  ProviderService,
  Quote,
  QuoteItemDraft,
  Review,
  ReviewInput,
  SavedAddress,
  SearchFilters,
  TravelPreview,
  TravelRequest,
  ServiceRequest,
  Proposal,
  ProposalRequest,
  RequestMessage,
  PaymentSchedule,
  CreateServiceRequestInput,
  SendProposalInput,
  DeliveryLink,
} from '../types';
import { buildSeed, DEMO_OTP, DEMO_PROVIDER_END_CODE, DEMO_USER_ID, type DemoBooking, type DemoDb } from './seed';

const SESSION_KEY = 'quickserve.demo.session';

let db: DemoDb = buildSeed();
let session: AuthSession | null = null;
let sessionLoaded = false;
let latency: [number, number] = [180, 520];
let autopilot = true;
let bookingSeq = 1046;
let idSeq = 1;
let demoCoinBalance = 12500;
let travelRequests: TravelRequest[] = [];
let serviceRequests: ServiceRequest[] = [];
let proposals: Proposal[] = [];
let requestMessages: RequestMessage[] = [];
let paymentSchedules: PaymentSchedule[] = [];
const demoCoinHistory: CoinLedgerEntry[] = [
  {
    id: 'coin-seed-1',
    user_id: DEMO_USER_ID,
    delta: 12500,
    kind: 'admin',
    booking_id: null,
    source_ledger_id: null,
    expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    ref: 'demo:welcome-coins',
    reason: 'Demo wallet credit',
    created_by: null,
    created_at: new Date().toISOString(),
  },
];
const authListeners = new Set<(s: AuthSession | null) => void>();
const bookingListeners = new Map<string, Set<() => void>>();
const messageListeners = new Map<string, Set<(m: Message) => void>>();
const myMessageListeners = new Set<(m: Message) => void>();
/** Chat read state per `${userId}:${bookingId}` → ISO time (mirrors booking_chat_reads). */
let chatReads: Record<string, string> = {};
const timers = new Set<ReturnType<typeof setTimeout>>();

// ---------- helpers ----------
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeq++}`;
const gen4 = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');

function wait(): Promise<void> {
  const [min, max] = latency;
  if (max <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) fail(message);
}

function uid(): string {
  if (!session) fail('Not signed in');
  return session.userId;
}

// Saved addresses per user (demo only; reset with the rest of the demo state on account deletion).
let addressBook: Record<string, SavedAddress[]> = {};

function myAddresses(): SavedAddress[] {
  const me = uid();
  if (!addressBook[me]) {
    const created = new Date(Date.now() - 90 * 86400000).toISOString();
    addressBook[me] = [
      { id: `addr-${me}-home`, label: 'Home', line1: 'Flat 302, Sri Sai Residency, Benz Circle', city: 'Vijayawada', lat: 16.5, lng: 80.651, is_default: true, created_at: created },
      { id: `addr-${me}-office`, label: 'Office', line1: '4th Floor, iHub Towers, MG Road, Labbipet', city: 'Vijayawada', lat: 16.504, lng: 80.642, is_default: false, created_at: created },
    ];
  }
  return addressBook[me]!;
}

function later(fn: () => void, ms: number) {
  if (!autopilot) return;
  const t = setTimeout(() => {
    timers.delete(t);
    try {
      fn();
    } catch {
      // The user may have moved the booking on already; simulated counterpart steps are best-effort.
    }
  }, ms);
  timers.add(t);
}

function notifyBooking(id: string) {
  bookingListeners.get(id)?.forEach((cb) => cb());
}

function findBooking(id: string): DemoBooking {
  return db.bookings.find((b) => b.id === id) ?? fail('Booking not found');
}

function categoryOf(categoryId: string) {
  const c = db.categories.find((x) => x.id === categoryId);
  return c ? { name: c.name, slug: c.slug } : null;
}

function nameOf(userId: string): string {
  return db.profiles.find((p) => p.id === userId)?.full_name || 'User';
}

function publicBooking(b: DemoBooking): Booking {
  const { address: _a, secrets: _s, ...rest } = b;
  const pro = db.providers.find((p) => p.id === b.provider_id);
  const travel = travelRequests.find((request) => request.id === b.travel_request_id);
  return clone({
    ...rest,
    travel_requests: travel
      ? {
          distance_km: travel.distance_km,
          quoted_fee: travel.quoted_fee,
          status: travel.status,
          expires_at: travel.expires_at,
        }
      : null,
    categories: categoryOf(b.category_id),
    providers: pro ? { rating_avg: pro.rating_avg, rating_count: pro.rating_count, profiles: { full_name: nameOf(pro.id) } } : null,
  });
}

function publicProvider(p: DemoDb['providers'][number]): Provider {
  const { lat: _lat, lng: _lng, ...rest } = p;
  return clone(rest);
}

function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function paidTotal(bookingId: string): number {
  return db.payments.filter((p) => p.booking_id === bookingId && p.status === 'paid').reduce((a, p) => a + p.amount, 0);
}

function setStatus(b: DemoBooking, to: BookingStatus, note: string | null = null) {
  db.events.push({ id: db.events.length + 1, booking_id: b.id, from_status: b.status, to_status: to, note, at: nowIso() });
  b.status = to;
  notifyBooking(b.id);
}

function logEvent(b: DemoBooking, note: string) {
  db.events.push({ id: db.events.length + 1, booking_id: b.id, from_status: b.status, to_status: b.status, note, at: nowIso() });
  notifyBooking(b.id);
}

function closeOpenQuotes(b: DemoBooking) {
  const open = db.quotes.filter((q) => q.booking_id === b.id && (q.status === 'sent' || q.status === 'approved_pending_payment'));
  for (const p of db.payments) {
    if (p.booking_id === b.id && p.status === 'created' && open.some((q) => q.id === p.quote_id)) p.status = 'failed';
  }
  open.forEach((q) => (q.status = 'superseded'));
}

function activateQuote(b: DemoBooking, q: Quote) {
  db.quotes.forEach((x) => {
    if (x.booking_id === b.id && x.status === 'approved' && x.id !== q.id) x.status = 'superseded';
  });
  q.status = 'approved';
  b.approved_quote_id = q.id;
  b.total_amount = requiredTotal(q.total, b.visit_fee, b.platform_fee);
}

function refundAll(b: DemoBooking) {
  let total = 0;
  db.payments.forEach((p) => {
    if (p.booking_id === b.id && p.status === 'paid') {
      p.status = 'refunded';
      total += p.amount;
    }
  });
  b.refund_amount += total;
}

function createPayout(b: DemoBooking, gross: number, commissionable: number, releaseAfter: Date) {
  if (db.payouts.some((p) => p.booking_id === b.id)) return;
  const provider = db.providers.find((p) => p.id === b.provider_id)!;
  const rateBp = commissionRateBp({
    jobsCompleted: provider.jobs_completed,
    providerCreatedAt: new Date(provider.created_at),
    at: new Date(),
  });
  const p = providerPayout({ gross, commissionable, rateBp });
  b.commission = p.commission;
  b.gst_on_commission = p.gst;
  db.payouts.push({
    id: newId('po'),
    booking_id: b.id,
    gross: p.gross,
    commission: p.commission,
    gst_on_commission: p.gst,
    amount: p.payout,
    status: 'pending',
    release_after: releaseAfter.toISOString(),
    created_at: nowIso(),
    transferred_at: null,
  });
}

const in24h = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

function finalizeCompletion(b: DemoBooking, note: string) {
  const q = db.quotes.find((x) => x.id === b.approved_quote_id);
  assert(q, 'no approved quote');
  closeOpenQuotes(b);
  b.completed_at = nowIso();
  createPayout(b, Math.max(q.total, b.visit_fee), q.subtotal_labour + (q.subtotal_travel ?? 0), in24h());
  const provider = db.providers.find((p) => p.id === b.provider_id);
  if (provider) provider.jobs_completed += 1;
  setStatus(b, 'completed', note);
}

function buildQuote(b: DemoBooking, items: QuoteItemDraft[], note: string | null): Quote {
  const version = Math.max(0, ...db.quotes.filter((q) => q.booking_id === b.id).map((q) => q.version)) + 1;
  const id = newId('q');
  const request = travelRequests.find((x) => x.id === b.travel_request_id && x.status === 'used');
  const travelLine = request
    ? {
        id: `${id}-travel`,
        quote_id: id,
        kind: 'other' as const,
        title: `Travel fee (${request.distance_km} km)`,
        qty: 1,
        unit_price: request.quoted_fee,
        bill_photo_url: null,
        travel_request_id: request.id,
      }
    : null;
  const lines = items.map((it, i) => ({
    id: `${id}-i${i}`,
    quote_id: id,
    kind: it.kind,
    title: it.title.trim(),
    qty: it.qty,
    unit_price: it.unit_price,
    bill_photo_url: it.bill_photo_url ?? null,
  }));
  const allLines = travelLine ? [travelLine, ...lines] : lines;
  const sub = quoteSubtotals(lines.map((l) => ({ kind: l.kind, qty: l.qty, unitPrice: l.unit_price })));
  return {
    id,
    booking_id: b.id,
    version,
    status: 'sent',
    is_change_order: b.status === 'in_progress',
    subtotal_labour: sub.labour,
    subtotal_parts: sub.parts,
    subtotal_other: sub.other + (request?.quoted_fee ?? 0),
    subtotal_travel: request?.quoted_fee ?? 0,
    total: sub.total + (request?.quoted_fee ?? 0),
    note,
    created_at: nowIso(),
    quote_items: allLines,
  };
}

function sendQuoteInternal(b: DemoBooking, items: QuoteItemDraft[], note: string | null): string {
  assert(['inspecting', 'quote_sent', 'in_progress'].includes(b.status), 'quote not allowed in this state');
  assert(items.length >= 1 && items.length <= 30, 'quote needs 1 to 30 items');
  for (const it of items) {
    assert(it.title.trim() !== '', 'item title is required');
    assert(it.qty > 0 && it.qty <= 1000, 'invalid quantity');
    assert(it.unit_price >= 0 && it.unit_price <= 10000000, 'invalid unit price');
  }
  closeOpenQuotes(b);
  const q = buildQuote(b, items, note);
  db.quotes.push(q);
  if (b.status === 'inspecting') setStatus(b, 'quote_sent', `quote v${q.version}`);
  else logEvent(b, `${b.status === 'in_progress' ? 'change order' : 'quote'} v${q.version}`);
  return q.id;
}

function approveInternal(b: DemoBooking, quoteId: string): number {
  const q = db.quotes.find((x) => x.id === quoteId && x.booking_id === b.id);
  assert(q && q.status === 'sent', 'quote is not open');
  const initial = b.status === 'quote_sent' && b.approved_quote_id == null;
  assert(initial || (b.status === 'in_progress' && b.approved_quote_id != null), 'quote cannot be approved in this state');
  const due = requiredTotal(q.total, b.visit_fee, b.platform_fee) - paidTotal(b.id);
  if (due > 0) {
    q.status = 'approved_pending_payment';
    if (initial) setStatus(b, 'awaiting_payment', `quote v${q.version} approved, due ${due}`);
    else logEvent(b, `change order v${q.version} approved, due ${due}`);
  } else {
    activateQuote(b, q);
    if (initial) setStatus(b, 'in_progress', `quote v${q.version} approved`);
    else logEvent(b, `change order v${q.version} approved`);
  }
  return Math.max(due, 0);
}

/** Mirrors prepare_payment: amount is always computed from booking state, never trusted from the client. */
function preparePayment(b: DemoBooking): Payment {
  let purpose: Payment['purpose'];
  let amount: number;
  let quoteId: string | null = null;
  if (b.status === 'pending_payment') {
    purpose = 'visit_fee';
    amount = b.visit_fee;
  } else if (b.status === 'awaiting_payment' || b.status === 'in_progress') {
    const q = db.quotes
      .filter((x) => x.booking_id === b.id && x.status === 'approved_pending_payment')
      .sort((a, c) => c.version - a.version)[0];
    assert(q, 'nothing to pay');
    purpose = 'balance';
    quoteId = q.id;
    amount = requiredTotal(q.total, b.visit_fee, b.platform_fee) - paidTotal(b.id);
  } else {
    fail('nothing to pay in this state');
  }
  assert(amount > 0, 'nothing to pay');
  const existing = db.payments.find(
    (p) => p.booking_id === b.id && p.status === 'created' && p.purpose === purpose && p.amount === amount && p.quote_id === quoteId,
  );
  if (existing) return existing;
  db.payments.forEach((p) => {
    if (p.booking_id === b.id && p.status === 'created') p.status = 'failed';
  });
  const p: Payment = {
    id: newId('pay'),
    booking_id: b.id,
    quote_id: quoteId,
    purpose,
    amount,
    status: 'created',
    created_at: nowIso(),
    paid_at: null,
  };
  db.payments.push(p);
  return p;
}

/** Mirrors record_payment_paid (the Razorpay webhook) for the booking's live payment link. */
function recordPaid(b: DemoBooking) {
  const p = [...db.payments].reverse().find((x) => x.booking_id === b.id && x.status === 'created');
  assert(p, 'No pending payment for this booking');
  let required: number | null = null;
  let q: Quote | undefined;
  if (p.purpose === 'visit_fee' && b.status === 'pending_payment') required = b.visit_fee;
  else if (p.purpose === 'balance' && p.quote_id) {
    q = db.quotes.find((x) => x.id === p.quote_id);
    if (q?.status === 'approved_pending_payment') required = requiredTotal(q.total, b.visit_fee, b.platform_fee);
  }
  const accept = required != null && paidTotal(b.id) + p.amount <= required;
  p.status = 'paid';
  p.paid_at = nowIso();
  if (!accept) {
    p.status = 'refunded';
    logEvent(b, 'payment not owed; refunded');
    return;
  }
  if (p.purpose === 'visit_fee') {
    setStatus(b, 'requested', 'visit fee paid');
    simulateProviderAfterVisitFee(b);
  } else if (q && required != null && paidTotal(b.id) >= required) {
    activateQuote(b, q);
    if (b.status === 'awaiting_payment') {
      setStatus(b, 'in_progress', 'balance paid');
      simulateProviderAfterBalance(b);
    } else logEvent(b, `change order v${q.version} paid`);
  }
}

// ---------- simulated counterpart ("autopilot") ----------
const PART_BY_CATEGORY: Record<string, [string, number]> = {
  'ac-repair': ['Capacitor 45uF', 65000],
  electrician: ['MCB 32A (Legrand)', 38000],
  plumber: ['Tap cartridge + washer set', 26000],
  'house-cleaning': ['Cleaning chemicals', 30000],
  'water-tank-cleaning': ['Disinfectant & UV treatment', 25000],
  'car-mechanic': ['Brake pads (front)', 180000],
  'bike-mechanic': ['Clutch cable', 32000],
  'appliance-repair': ['Drain pump', 140000],
  'pest-control': ['Gel bait (2 tubes)', 40000],
  carpenter: ['Hinges & screws', 22000],
  painter: ['Primer (4 L)', 120000],
};

function isSimulatedProvider(b: DemoBooking) {
  return b.customer_id === session?.userId && b.provider_id !== session?.userId;
}

function simulateProviderAfterVisitFee(b: DemoBooking) {
  if (!isSimulatedProvider(b)) return;
  later(() => {
    if (b.status !== 'requested') return;
    b.accepted_at = nowIso();
    setStatus(b, 'accepted');
    pushMessage(b.id, b.provider_id, `Hi ${nameOf(b.customer_id).split(' ')[0]}, I've accepted your booking. Leaving shortly.`);
    later(() => {
      if (b.status !== 'accepted') return;
      setStatus(b, 'en_route');
      later(() => {
        if (b.status !== 'en_route') return;
        setStatus(b, 'inspecting', 'start code verified');
        later(() => {
          if (b.status !== 'inspecting') return;
          const svc = db.services.find((s) => s.id === b.provider_service_id);
          const slug = categoryOf(b.category_id)?.slug ?? '';
          const [part, partPrice] = PART_BY_CATEGORY[slug] ?? ['Spare part', 30000];
          const labourTitle = svc?.rate_card_items?.[0]?.title ?? 'Repair labour';
          const labourPrice = svc?.rate_card_items?.[0]?.price ?? svc?.labour_rate ?? 50000;
          sendQuoteInternal(
            b,
            [
              { kind: 'labour', title: labourTitle, qty: 1, unit_price: labourPrice },
              { kind: 'part', title: part, qty: 1, unit_price: partPrice },
            ],
            'Inspection done. Here is the itemised quote.',
          );
          pushMessage(b.id, b.provider_id, 'I have sent the quote. Approve it in the app and I will start right away.');
        }, 6000);
      }, 8000);
    }, 5000);
  }, 4000);
}

function simulateProviderAfterBalance(b: DemoBooking) {
  if (!isSimulatedProvider(b)) return;
  later(() => {
    if (b.status !== 'in_progress') return;
    const open = db.quotes.some((q) => q.booking_id === b.id && (q.status === 'sent' || q.status === 'approved_pending_payment'));
    if (open) return;
    b.secrets.end_otp = gen4();
    b.secrets.end_attempts = 0;
    b.completion_requested_at = nowIso();
    setStatus(b, 'completion_requested');
    pushMessage(b.id, b.provider_id, 'Work is done! Please check and share the completion code if you are happy.');
  }, 9000);
}

function simulateCustomerApproval(b: DemoBooking, quoteId: string) {
  if (b.provider_id !== session?.userId || b.customer_id === session?.userId) return;
  later(() => {
    const q = db.quotes.find((x) => x.id === quoteId);
    if (!q || q.status !== 'sent') return;
    const due = approveInternal(b, quoteId);
    if (due > 0) {
      preparePayment(b);
      later(() => recordPaid(b), 2500);
    }
    pushMessage(b.id, b.customer_id, due > 0 ? 'Approved the quote, paying now.' : 'Approved, please go ahead.');
  }, 5000);
}

const AUTO_REPLIES = [
  'Sure, noted 👍',
  'Okay, will do.',
  'Thanks for letting me know!',
  'Got it. See you soon.',
];

function pushMessage(bookingId: string, senderId: string, body: string): Message {
  const m: Message = { id: newId('m'), booking_id: bookingId, sender_id: senderId, body, image_url: null, created_at: nowIso() };
  db.messages.push(m);
  chatReads[`${senderId}:${bookingId}`] = m.created_at;
  messageListeners.get(bookingId)?.forEach((cb) => cb(clone(m)));
  const b = db.bookings.find((x) => x.id === bookingId);
  if (session && b && (b.customer_id === session.userId || b.provider_id === session.userId)) {
    myMessageListeners.forEach((cb) => cb(clone(m)));
  }
  return m;
}

// ---------- session ----------
async function loadSession() {
  if (sessionLoaded) return;
  sessionLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    session = raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    session = null;
  }
}

async function setSession(next: AuthSession | null) {
  session = next;
  sessionLoaded = true;
  try {
    if (next) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // Persistence is a convenience only.
  }
  authListeners.forEach((cb) => cb(next));
}

function clearTimers() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
}

// ---------- Api ----------
export const demoApi: Api = {
  async getSession() {
    await loadSession();
    return session ? { ...session } : null;
  },

  onAuthChange(cb) {
    authListeners.add(cb);
    return () => authListeners.delete(cb);
  },

  async sendOtp(phone) {
    await wait();
    assert(/^\+91[6-9]\d{9}$/.test(phone), 'Enter a valid Indian mobile number.');
  },

  async verifyOtp(phone, token) {
    await wait();
    assert(token === DEMO_OTP, `Incorrect code. In demo mode the code is ${DEMO_OTP}.`);
    await setSession({ userId: DEMO_USER_ID, phone });
  },

  async signOut() {
    clearTimers();
    await setSession(null);
  },

  async requestAccountDeletion() {
    await wait();
    clearTimers();
    db = buildSeed();
    travelRequests = [];
    serviceRequests = [];
    proposals = [];
    requestMessages = [];
    paymentSchedules = [];
    chatReads = {};
    addressBook = {};
    await setSession(null);
  },

  async getMyProfile() {
    await wait();
    const p = db.profiles.find((x) => x.id === uid());
    return p ? clone(p) : null;
  },

  async updateMyProfile(patch) {
    await wait();
    const p = db.profiles.find((x) => x.id === uid());
    assert(p, 'Profile not found');
    Object.assign(p, patch);
  },

  async listCategories() {
    await wait();
    return clone([...db.categories].sort((a, b) => a.sort_order - b.sort_order));
  },

  async createServiceRequest(input: CreateServiceRequestInput) {
    const id = newId('request');
    serviceRequests.unshift({
      id, customer_id: uid(), category_id: input.categoryId, city: input.city, area: input.area,
      event_start: input.eventStart.toISOString(), event_end: input.eventEnd.toISOString(),
      intake: clone(input.intake), budget_min: input.budgetMin, budget_max: input.budgetMax,
      status: 'open', expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), created_at: nowIso(),
    });
    return id;
  },
  async cancelServiceRequest(id) {
    const row = serviceRequests.find((r) => r.id === id && r.customer_id === uid());
    assert(row, 'Request not found');
    row.status = 'cancelled';
  },
  async listMyServiceRequests() { return serviceRequests.filter((r) => r.customer_id === uid()).map(clone); },
  async listProviderServiceRequests() { return [] as ProposalRequest[]; },
  async getServiceRequest(id) { return clone(serviceRequests.find((r) => r.id === id && r.customer_id === uid()) ?? null); },
  async listRequestProposals(requestId) { return proposals.filter((p) => p.request_id === requestId).map(clone); },
  async getProposal(id) { return clone(proposals.find((p) => p.id === id) ?? fail('Proposal not found')); },
  async sendProposal(input: SendProposalInput) {
    assert(serviceRequests.some((r) => r.id === input.requestId), 'Request not found');
    const id = newId('proposal');
    const total = input.items.reduce((sum, item) => sum + Math.round(item.qty * item.unit_price), 0);
    proposals.push({
      id, request_id: input.requestId, provider_id: uid(), provider_service_id: 'demo-service',
      version: 1, status: 'sent', total, valid_until: input.validUntil.toISOString(),
      note: input.note ?? null, deliverables: clone(input.deliverables ?? []), created_at: nowIso(),
      proposal_items: input.items.map((item, i) => ({ ...clone(item), proposal_id: id, seq: i + 1 })),
      proposal_schedule: input.schedule.map((row, i) => ({
        ...clone(row), id: newId('proposal-schedule'), proposal_id: id, seq: i + 1,
        due_at: row.due_rule === 'at_booking' ? nowIso() : null,
      })),
    });
    return id;
  },
  async withdrawProposal(id) {
    const p = proposals.find((x) => x.id === id && x.provider_id === uid());
    assert(p?.status === 'sent', 'Proposal is not open');
    p.status = 'withdrawn';
  },
  async acceptProposal(id) {
    const p = proposals.find((x) => x.id === id);
    assert(p?.status === 'sent', 'Proposal not found');
    p.status = 'accepted';
    const request = serviceRequests.find((r) => r.id === p.request_id);
    if (request) request.status = 'closed';
    const bookingId = newId('proposal-booking');
    paymentSchedules.push(...p.proposal_schedule.map((row) => ({
      id: row.id, booking_id: bookingId, seq: row.seq, label: row.label, amount: row.amount,
      due_rule: row.due_rule, due_at: row.due_at, status: row.due_rule === 'at_booking' ? 'due' : 'upcoming',
      purpose: row.due_rule === 'at_booking' ? 'advance' : row.due_rule === 'on_delivery' ? 'final' : 'milestone',
      obligation_kind: 'service', payment_id: null, reminded_at: null, paid_at: null,
    })) as PaymentSchedule[]);
    return bookingId;
  },
  async listRequestMessages(requestId, providerId) {
    return requestMessages.filter((m) => m.request_id === requestId && m.provider_id === providerId).map(clone);
  },
  async sendRequestMessage(requestId, providerId, body) {
    requestMessages.push({
      id: newId('request-message'), request_id: requestId, provider_id: providerId,
      sender_id: uid(), body: body.trim(), created_at: nowIso(),
    });
  },
  async listPaymentSchedule(bookingId) { return paymentSchedules.filter((s) => s.booking_id === bookingId).map(clone); },
  async createSchedulePayment(bookingId, scheduleId) {
    const row = paymentSchedules.find((s) => s.booking_id === bookingId && s.id === scheduleId);
    assert(row?.status === 'due', 'Milestone is not due');
    return { short_url: `demo://milestone/${scheduleId}`, amount: row.amount, purpose: row.purpose, schedule_id: scheduleId };
  },
  async startProposalBooking() { return { ok: true }; },
  async beginDelivery() {},
  async submitDelivery(_bookingId, _links: DeliveryLink[]) {},
  async acceptDelivery() {},

  async searchProviders(categorySlug: string, coords: Coords | null, f: SearchFilters): Promise<ProviderSearchResult[]> {
    await wait();
    const me = session?.userId;
    const cat = db.categories.find((c) => c.slug === categorySlug);
    if (!cat) return [];
    const rows = db.services
      .filter((s) => s.category_id === cat.id && s.active && s.provider_id !== me)
      .map((s) => {
        const p = db.providers.find((x) => x.id === s.provider_id)!;
        const distance = coords ? haversineKm(coords, p) : null;
        const bayes = (10 * 4.0 + p.rating_avg * p.rating_count) / (10 + p.rating_count);
        return { s, p, distance, bayes };
      })
      .filter(({ p, distance }) => p.kyc_status === 'verified' && !p.suspended && (distance == null || distance <= p.service_radius_km))
      .filter(({ s, p }) => f.minRating == null || p.rating_avg >= f.minRating)
      .filter(({ s }) => f.skillLevel == null || s.skill_level === f.skillLevel)
      .filter(({ s }) => f.maxVisitFee == null || s.visit_fee <= f.maxVisitFee)
      .filter(({ p }) => !f.onlineOnly || p.is_online);
    const maxD = Math.max(1, ...rows.map((r) => r.distance ?? 0));
    const scored = rows.map((r) => ({
      ...r,
      score:
        0.6 * Math.min(Math.max((r.bayes - 1) / 4, 0), 1) +
        0.15 * 0.85 +
        0.15 * (r.distance == null ? 0.5 : 1 - r.distance / maxD) +
        0.1 * (r.p.is_online ? 0.8 : 0.4),
    }));
    const by = (fn: (x: (typeof scored)[number]) => number) => (a: (typeof scored)[number], b: (typeof scored)[number]) =>
      fn(a) - fn(b) || b.score - a.score;
    const sorters: Record<SearchFilters['sort'], (a: (typeof scored)[number], b: (typeof scored)[number]) => number> = {
      recommended: (a, b) => b.score - a.score,
      rating: by((x) => -(x.p.rating_avg * 1000 + x.p.rating_count / 1000)),
      price: by((x) => x.s.visit_fee),
      distance: by((x) => x.distance ?? Number.MAX_SAFE_INTEGER),
      experience: by((x) => -x.p.years_experience),
    };
    return scored.sort(sorters[f.sort]).map(({ s, p, distance, score }) => ({
      provider_id: p.id,
      provider_service_id: s.id,
      full_name: nameOf(p.id),
      avatar_url: null,
      city: p.city,
      skill_level: s.skill_level,
      visit_fee: s.visit_fee,
      labour_rate: s.labour_rate,
      rate_unit: s.rate_unit,
      rating_avg: p.rating_avg,
      rating_count: p.rating_count,
      jobs_completed: p.jobs_completed,
      years_experience: p.years_experience,
      is_online: p.is_online,
      distance_km: distance,
      score,
    }));
  },

  async listTopRated(limit = 10): Promise<TopRatedProvider[]> {
    await wait();
    return db.providers
      .filter((p) => p.kyc_status === 'verified' && !p.suspended && p.rating_count > 0 && p.id !== session?.userId)
      .sort((a, b) => b.rating_avg - a.rating_avg || b.rating_count - a.rating_count)
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        city: p.city,
        rating_avg: p.rating_avg,
        rating_count: p.rating_count,
        jobs_completed: p.jobs_completed,
        years_experience: p.years_experience,
        is_online: p.is_online,
        profiles: { full_name: nameOf(p.id), avatar_url: null },
        provider_services: db.services
          .filter((s) => s.provider_id === p.id && s.active)
          .map((s) => ({ visit_fee: s.visit_fee, skill_level: s.skill_level, active: s.active, categories: categoryOf(s.category_id) })),
      }));
  },

  async getProviderDetail(providerId): Promise<ProviderDetail> {
    await wait();
    const p = db.providers.find((x) => x.id === providerId) ?? fail('Provider not found');
    return {
      provider: { ...publicProvider(p), profiles: { full_name: nameOf(p.id), avatar_url: null } },
      services: clone(
        db.services
          .filter((s) => s.provider_id === providerId && s.active)
          .map((s) => ({ ...s, categories: categoryOf(s.category_id) })),
      ),
      reviews: clone(
        db.reviews
          .filter((r) => r.provider_id === providerId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 50),
      ),
    };
  },

  async getProviderService(id): Promise<ProviderServiceWithProvider> {
    await wait();
    const s = db.services.find((x) => x.id === id) ?? fail('Service not found');
    const pro = db.providers.find((x) => x.id === s.provider_id);
    return clone({
      ...s,
      categories: categoryOf(s.category_id),
      providers: {
        service_radius_km: pro?.service_radius_km ?? 0,
        rating_avg: pro?.rating_avg ?? 0,
        rating_count: pro?.rating_count ?? 0,
        profiles: { full_name: nameOf(s.provider_id) },
      },
    });
  },

  async listMyAddresses() {
    await wait();
    return clone(myAddresses());
  },

  async addAddress(input: NewAddressInput) {
    await wait();
    assert(input.line1.trim() !== '' && input.city.trim() !== '', 'address is required');
    const list = myAddresses();
    const a: SavedAddress = {
      id: `addr-${uid()}-${idSeq++}`,
      label: input.label.trim() || 'Other',
      line1: input.line1.trim(),
      city: input.city.trim(),
      lat: input.lat,
      lng: input.lng,
      is_default: list.length === 0,
      created_at: new Date().toISOString(),
    };
    list.push(a);
    return clone(a);
  },

  async inspectTravelRequest(providerServiceId, coords, scheduledAt): Promise<TravelPreview> {
    await wait();
    const me = uid();
    const service = db.services.find((x) => x.id === providerServiceId && x.active) ?? fail('Service not available');
    const provider = db.providers.find((x) => x.id === service.provider_id) ?? fail('Provider not found');
    const distance = Math.round(haversineKm({ lat: provider.lat, lng: provider.lng }, coords) * 10) / 10;
    const needsApproval = distance > provider.service_radius_km;
    const fee =
      !needsApproval || service.travel_fee_mode === 'none'
        ? 0
        : service.travel_fee_mode === 'flat'
          ? service.travel_fee_flat ?? 0
          : Math.round(Math.max(distance - provider.service_radius_km, 0) * (service.travel_fee_per_km ?? 0));
    const start = scheduledAt?.toISOString() ?? null;
    const request = start
      ? travelRequests.find(
          (x) => x.customer_id === me && x.provider_service_id === providerServiceId && x.window_start === start,
        ) ?? null
      : null;
    return {
      needs_approval: needsApproval,
      allowed: !needsApproval || (service.max_travel_km != null && distance <= service.max_travel_km),
      distance_km: distance,
      max_travel_km: service.max_travel_km ?? null,
      quoted_fee: fee,
      travel_request_id: request?.id ?? null,
      status: request?.status ?? null,
      expires_at: request?.expires_at ?? null,
    };
  },

  async createTravelRequest(providerServiceId, scheduledAt, coords, note = '') {
    await wait();
    const preview = await demoApi.inspectTravelRequest(providerServiceId, coords, scheduledAt);
    assert(preview.needs_approval, 'travel approval is only required beyond the service radius');
    assert(preview.allowed, 'provider does not travel this far');
    assert(scheduledAt.getTime() > Date.now() + 30 * 60 * 1000, 'travel request must start at least 30 minutes from now');
    if (preview.travel_request_id) return preview.travel_request_id;
    const service = db.services.find((x) => x.id === providerServiceId)!;
    const customerId = uid();
    const start = scheduledAt.toISOString();
    const request: TravelRequest = {
      id: newId('travel'),
      customer_id: customerId,
      provider_id: service.provider_id,
      provider_service_id: providerServiceId,
      customer_name: nameOf(customerId),
      provider_name: nameOf(service.provider_id),
      category_name: db.categories.find((x) => x.id === service.category_id)?.name ?? 'Service',
      service_window: `[${start},${new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000).toISOString()})`,
      window_start: start,
      window_end: new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      distance_km: preview.distance_km ?? 0,
      quoted_fee: preview.quoted_fee,
      status: 'pending',
      expires_at: new Date(Math.min(Date.now() + 2 * 60 * 60 * 1000, scheduledAt.getTime() - 30 * 60 * 1000)).toISOString(),
      request_note: note.trim() || null,
      response_reason: null,
      created_at: nowIso(),
      role: 'customer',
    };
    travelRequests.push(request);
    return request.id;
  },

  async listMyTravelRequests(status) {
    await wait();
    const me = uid();
    return clone(
      travelRequests
        .filter((x) => (x.customer_id === me || x.provider_id === me) && (!status || x.status === status))
        .map((x): TravelRequest => ({ ...x, role: x.customer_id === me ? 'customer' : 'provider' }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  },

  async respondToTravelRequest(id, approve, reason) {
    await wait();
    const request = travelRequests.find((x) => x.id === id) ?? fail('Travel request not found');
    assert(request.provider_id === uid(), 'only the assigned provider can respond');
    assert(request.status === 'pending', 'travel request is not pending');
    assert(new Date(request.expires_at).getTime() > Date.now(), 'travel request expired');
    assert(approve || !!reason?.trim(), 'decline reason is required');
    request.status = approve ? 'approved' : 'declined';
    request.response_reason = reason?.trim() || null;
  },

  async createBooking(input: CreateBookingInput) {
    await wait();
    const me = uid();
    const s = db.services.find((x) => x.id === input.providerServiceId && x.active);
    const p = s && db.providers.find((x) => x.id === s.provider_id);
    assert(s && p && p.kyc_status === 'verified' && !p.suspended, 'service not available');
    assert(s.provider_id !== me, 'cannot book yourself');
    assert(input.addressLine.trim() !== '' && input.city.trim() !== '', 'address is required');
    assert(input.scheduledAt == null || input.scheduledAt.getTime() > Date.now() - 5 * 60 * 1000, 'scheduled time is in the past');
    assert(input.photos.length <= 4, 'at most 4 photos');
    const distance = haversineKm({ lat: p.lat, lng: p.lng }, input.coords);
    let travel: TravelRequest | null = null;
    if (distance > p.service_radius_km) {
      assert(input.travelRequestId, 'travel approval required before booking');
      travel = travelRequests.find((x) => x.id === input.travelRequestId) ?? fail('travel request not found');
      assert(travel.customer_id === me, 'travel request belongs to another customer');
      assert(travel.provider_service_id === s.id, 'travel request is for another service');
      assert(travel.window_start === input.scheduledAt?.toISOString(), 'travel request is for another window');
      assert(travel.status === 'approved', 'travel request is not approved');
      assert(new Date(travel.expires_at).getTime() > Date.now(), 'travel request expired');
      assert(Math.abs(travel.distance_km - Math.round(distance * 10) / 10) < 0.11, 'travel request location does not match the booking');
      travel.status = 'used';
    } else {
      assert(!input.travelRequestId, 'travel request is not required for this booking');
    }
    const b: DemoBooking = {
      id: `QS${bookingSeq++}`,
      customer_id: me,
      provider_id: s.provider_id,
      category_id: s.category_id,
      provider_service_id: s.id,
      description: input.description,
      photos: input.photos,
      scheduled_at: input.scheduledAt?.toISOString() ?? null,
      travel_request_id: input.travelRequestId ?? null,
      status: 'pending_payment',
      visit_fee: s.visit_fee,
      platform_fee: 2900,
      approved_quote_id: null,
      total_amount: null,
      commission: null,
      gst_on_commission: null,
      refund_amount: 0,
      cancelled_reason: null,
      created_at: nowIso(),
      accepted_at: null,
      completion_requested_at: null,
      completed_at: null,
      address: { area: input.city.trim(), line1: input.addressLine.trim(), lat: input.coords.lat, lng: input.coords.lng },
      secrets: { start_otp: gen4(), end_otp: null, start_attempts: 0, end_attempts: 0 },
    };
    db.bookings.push(b);
    db.events.push({ id: db.events.length + 1, booking_id: b.id, from_status: null, to_status: 'pending_payment', note: null, at: nowIso() });
    return b.id;
  },

  async createPayment(bookingId): Promise<PaymentLinkResponse> {
    await wait();
    const b = findBooking(bookingId);
    assert(b.customer_id === uid(), 'only the customer can pay');
    const p = preparePayment(b);
    return { short_url: `demo://checkout/${p.id}`, amount: p.amount, purpose: p.purpose };
  },

  async listMyBookings() {
    await wait();
    const me = uid();
    return db.bookings
      .filter((b) => b.customer_id === me)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(publicBooking);
  },

  async getBooking(id) {
    await wait();
    const b = findBooking(id);
    const me = uid();
    assert(b.customer_id === me || b.provider_id === me, 'Booking not found');
    return publicBooking(b);
  },

  async getQuotes(bookingId) {
    await wait();
    return clone(db.quotes.filter((q) => q.booking_id === bookingId).sort((a, b) => b.version - a.version));
  },

  async getPayments(bookingId) {
    await wait();
    return clone(db.payments.filter((p) => p.booking_id === bookingId).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  },

  async getEvents(bookingId) {
    await wait();
    return clone(db.events.filter((e) => e.booking_id === bookingId));
  },

  async getBookingOtps(bookingId) {
    await wait();
    const b = findBooking(bookingId);
    if (b.customer_id !== uid()) return null;
    return {
      start_otp: b.status === 'accepted' || b.status === 'en_route' ? b.secrets.start_otp : null,
      start_locked: b.secrets.start_attempts >= 5,
      end_otp: b.status === 'completion_requested' ? b.secrets.end_otp : null,
      end_locked: b.secrets.end_attempts >= 5,
    };
  },

  async getBookingAddress(bookingId) {
    await wait();
    const b = findBooking(bookingId);
    const me = uid();
    if (b.customer_id !== me && b.provider_id !== me) return null;
    const full = b.customer_id === me || b.accepted_at != null;
    return { area: b.address.area, address_line: full ? b.address.line1 : null, lat: full ? b.address.lat : null, lng: full ? b.address.lng : null };
  },

  async getReviewForBooking(bookingId) {
    await wait();
    const r = db.reviews.find((x) => x.booking_id === bookingId);
    return r ? clone(r) : null;
  },

  async getProfileName(userId) {
    return nameOf(userId);
  },

  async signedPhotoUrls(paths) {
    return [...paths];
  },

  async uploadJobPhoto(uri) {
    await wait();
    return uri;
  },

  async acceptBooking(id) {
    await wait();
    const b = findBooking(id);
    assert(b.provider_id === uid(), 'only the provider can accept');
    assert(b.status === 'requested', 'booking is not awaiting acceptance');
    b.accepted_at = nowIso();
    setStatus(b, 'accepted');
  },

  async declineBooking(id, reason) {
    await wait();
    const b = findBooking(id);
    assert(b.provider_id === uid(), 'only the provider can decline');
    assert(b.status === 'requested', 'booking is not awaiting acceptance');
    b.cancelled_reason = reason ?? null;
    refundAll(b);
    setStatus(b, 'declined', reason ?? null);
  },

  async startTrip(id) {
    await wait();
    const b = findBooking(id);
    assert(b.provider_id === uid(), 'only the provider can start the trip');
    assert(b.status === 'accepted', 'booking is not accepted');
    setStatus(b, 'en_route');
  },

  async arrive(id, otp): Promise<OtpResult> {
    await wait();
    const b = findBooking(id);
    assert(b.provider_id === uid(), 'only the provider can mark arrival');
    assert(b.status === 'en_route', 'provider is not en route');
    if (b.secrets.start_attempts >= 5) return { ok: false, error: 'locked', attempts_left: 0 };
    if (otp !== b.secrets.start_otp) {
      b.secrets.start_attempts += 1;
      return { ok: false, error: 'invalid_otp', attempts_left: 5 - b.secrets.start_attempts };
    }
    b.secrets.start_attempts = 0;
    setStatus(b, 'inspecting');
    return { ok: true };
  },

  async regenerateOtp(id, kind) {
    await wait();
    const b = findBooking(id);
    assert(b.customer_id === uid(), 'only the customer can regenerate codes');
    if (kind === 'start') {
      assert(b.status === 'accepted' || b.status === 'en_route', 'start code not applicable now');
      b.secrets.start_otp = gen4();
      b.secrets.start_attempts = 0;
    } else {
      assert(b.status === 'completion_requested', 'end code not applicable now');
      b.secrets.end_otp = gen4();
      b.secrets.end_attempts = 0;
    }
    logEvent(b, `${kind} code regenerated`);
  },

  async sendQuote(bookingId, items, note) {
    await wait();
    const b = findBooking(bookingId);
    assert(b.provider_id === uid(), 'only the provider can send a quote');
    const id = sendQuoteInternal(b, items, note ?? null);
    simulateCustomerApproval(b, id);
    return id;
  },

  async approveQuote(bookingId, quoteId, useCoins = false) {
    await wait();
    const b = findBooking(bookingId);
    assert(b.customer_id === uid(), 'only the customer can approve');
    const q = db.quotes.find((x) => x.id === quoteId && x.booking_id === b.id);
    assert(q && q.status === 'sent', 'quote is not open');
    let redeemed = b.coin_discount ?? 0;
    if (!redeemed && useCoins) {
      const provider = db.providers.find((p) => p.id === b.provider_id)!;
      const rateBp = commissionRateBp({
        jobsCompleted: provider.jobs_completed,
        providerCreatedAt: new Date(provider.created_at),
        at: new Date(),
      });
      const payout = providerPayout({ gross: q.total, commissionable: q.subtotal_labour, rateBp });
      redeemed = coinRedemptionLimit({
        balancePaise: demoCoinBalance,
        serviceValuePaise: Math.max(q.total, b.visit_fee),
        platformRevenuePaise: Math.max(0, payout.commission + b.platform_fee - payout.gst),
      });
      if (redeemed > 0) {
        const createdAt = nowIso();
        db.payments.push({
          id: newId('pay'),
          booking_id: b.id,
          quote_id: q.id,
          purpose: 'balance',
          amount: redeemed,
          status: 'paid',
          funding_source: 'coins',
          created_at: createdAt,
          paid_at: createdAt,
        });
        demoCoinBalance -= redeemed;
        b.coin_discount = redeemed;
        q.coin_discount = redeemed;
        demoCoinHistory.unshift({
          id: newId('coin'),
          user_id: uid(),
          delta: -redeemed,
          kind: 'redeem',
          booking_id: b.id,
          source_ledger_id: demoCoinHistory[0]?.id ?? null,
          expires_at: null,
          ref: `demo:redeem:${b.id}`,
          reason: 'Seva Coins redeemed on a QuickServe booking',
          created_by: null,
          created_at: createdAt,
        });
      }
    }
    const amount_due = approveInternal(b, quoteId);
    if (amount_due === 0 && b.status === 'in_progress') simulateProviderAfterBalance(b);
    return redeemed > 0 ? { amount_due, coins_redeemed_paise: redeemed } : { amount_due };
  },

  async getMyCoinBalance() {
    await wait();
    return demoCoinBalance;
  },

  async listCoinHistory(limit = 50) {
    await wait();
    return clone(demoCoinHistory.slice(0, limit));
  },

  async getCoinRedemptionPreview(bookingId, quoteId): Promise<CoinRedemptionPreview> {
    await wait();
    const b = findBooking(bookingId);
    const q = db.quotes.find((x) => x.id === quoteId && x.booking_id === b.id);
    assert(q && q.status === 'sent', 'quote is not open');
    const provider = db.providers.find((p) => p.id === b.provider_id)!;
    const rateBp = commissionRateBp({
      jobsCompleted: provider.jobs_completed,
      providerCreatedAt: new Date(provider.created_at),
      at: new Date(),
    });
    const payout = providerPayout({ gross: q.total, commissionable: q.subtotal_labour, rateBp });
    const serviceCap = Math.floor(Math.max(q.total, b.visit_fee) * 0.1);
    const platformCap = Math.max(0, payout.commission + b.platform_fee - payout.gst);
    return {
      balance_paise: demoCoinBalance,
      service_cap_paise: serviceCap,
      platform_cap_paise: platformCap,
      maximum_paise: coinRedemptionLimit({
        balancePaise: demoCoinBalance,
        serviceValuePaise: Math.max(q.total, b.visit_fee),
        platformRevenuePaise: platformCap,
      }),
      applied_paise: Math.min(b.coin_discount ?? 0, serviceCap, platformCap),
    };
  },

  async rejectQuote(bookingId, quoteId) {
    await wait();
    const b = findBooking(bookingId);
    assert(b.customer_id === uid(), 'only the customer can reject');
    const q = db.quotes.find((x) => x.id === quoteId && x.booking_id === b.id);
    assert(q && q.status === 'sent', 'quote is not open');
    q.status = 'rejected';
    if (b.status === 'quote_sent' && b.approved_quote_id == null) {
      createPayout(b, b.visit_fee, b.visit_fee, in24h());
      setStatus(b, 'closed_no_work', `quote v${q.version} rejected`);
    } else {
      logEvent(b, `change order v${q.version} rejected`);
    }
  },

  async requestCompletion(id) {
    await wait();
    const b = findBooking(id);
    assert(b.provider_id === uid(), 'only the provider can request completion');
    assert(b.status === 'in_progress', 'job is not in progress');
    assert(
      !db.quotes.some((q) => q.booking_id === b.id && (q.status === 'sent' || q.status === 'approved_pending_payment')),
      'resolve the pending change order first',
    );
    // Simulated customers always read out the documented demo code.
    b.secrets.end_otp = DEMO_PROVIDER_END_CODE;
    b.secrets.end_attempts = 0;
    b.completion_requested_at = nowIso();
    setStatus(b, 'completion_requested');
  },

  async completeBooking(id, otp): Promise<OtpResult> {
    await wait();
    const b = findBooking(id);
    assert(b.provider_id === uid(), 'only the provider can complete');
    assert(b.status === 'completion_requested', 'completion was not requested');
    if (b.secrets.end_attempts >= 5) return { ok: false, error: 'locked', attempts_left: 0 };
    if (!b.secrets.end_otp || otp !== b.secrets.end_otp) {
      b.secrets.end_attempts += 1;
      return { ok: false, error: 'invalid_otp', attempts_left: 5 - b.secrets.end_attempts };
    }
    finalizeCompletion(b, 'end code verified');
    return { ok: true };
  },

  async confirmCompletion(id) {
    await wait();
    const b = findBooking(id);
    assert(b.customer_id === uid(), 'only the customer can confirm');
    assert(b.status === 'completion_requested', 'completion was not requested');
    finalizeCompletion(b, 'confirmed by customer');
  },

  async cancelBooking(id, reason) {
    await wait();
    const b = findBooking(id);
    assert(b.customer_id === uid(), 'only the customer can cancel');
    assert(
      ['pending_payment', 'requested', 'accepted', 'en_route', 'awaiting_payment'].includes(b.status),
      'booking can no longer be cancelled',
    );
    b.cancelled_reason = reason ?? null;
    db.payments.forEach((p) => {
      if (p.booking_id === b.id && p.status === 'created') p.status = 'failed';
    });
    closeOpenQuotes(b);
    if (b.status === 'en_route' || b.status === 'awaiting_payment') createPayout(b, b.visit_fee, b.visit_fee, in24h());
    else refundAll(b);
    setStatus(b, 'cancelled', reason ?? null);
  },

  async disputeBooking(id, reason) {
    await wait();
    const b = findBooking(id);
    assert(b.customer_id === uid(), 'only the customer can raise a dispute');
    assert(['in_progress', 'completion_requested', 'completed'].includes(b.status), 'dispute not allowed in this state');
    assert(reason.trim() !== '', 'reason is required');
    db.payouts.forEach((p) => {
      if (p.booking_id === b.id && p.status === 'pending') p.status = 'frozen';
    });
    setStatus(b, 'disputed', reason);
  },

  async submitReview(bookingId, r: ReviewInput) {
    await wait();
    const b = findBooking(bookingId);
    assert(b.customer_id === uid(), 'only the customer can review');
    assert(b.status === 'completed' || b.status === 'closed', 'only completed jobs can be reviewed');
    assert(b.total_amount != null && paidTotal(b.id) >= b.total_amount, 'only jobs paid in the app can be reviewed');
    assert(!db.reviews.some((x) => x.booking_id === b.id), 'already reviewed');
    const review: Review = {
      id: newId('rv'),
      booking_id: b.id,
      customer_id: b.customer_id,
      provider_id: b.provider_id,
      rating: r.rating,
      punctuality: r.punctuality ?? null,
      quality: r.quality ?? null,
      behaviour: r.behaviour ?? null,
      pricing: r.pricing ?? null,
      comment: r.comment?.trim() || null,
      provider_reply: null,
      tags: r.tags ?? [],
      created_at: nowIso(),
    };
    db.reviews.push(review);
    const p = db.providers.find((x) => x.id === b.provider_id);
    if (p) {
      p.rating_avg = Math.round(((p.rating_avg * p.rating_count + r.rating) / (p.rating_count + 1)) * 100) / 100;
      p.rating_count += 1;
    }
    notifyBooking(b.id);
    return review.id;
  },

  async getMyProvider() {
    await wait();
    const p = db.providers.find((x) => x.id === uid());
    return p ? publicProvider(p) : null;
  },

  async upsertProviderProfile(input: ProviderProfileInput) {
    await wait();
    const me = uid();
    const profile = db.profiles.find((x) => x.id === me);
    if (profile) {
      if (input.fullName.trim()) profile.full_name = input.fullName.trim();
      profile.role_provider = true;
    }
    const existing = db.providers.find((x) => x.id === me);
    const fields = {
      bio: input.bio,
      city: input.city,
      service_radius_km: input.serviceRadiusKm,
      years_experience: input.yearsExperience,
      languages: input.languages,
    };
    if (existing) {
      Object.assign(existing, fields);
      if (input.coords) Object.assign(existing, input.coords);
    } else {
      db.providers.push({
        id: me,
        ...fields,
        kyc_status: 'pending',
        suspended: false,
        is_online: false,
        rating_avg: 0,
        rating_count: 0,
        jobs_completed: 0,
        commission_tier: 0,
        razorpay_account_id: null,
        created_at: nowIso(),
        lat: input.coords?.lat ?? 16.4995,
        lng: input.coords?.lng ?? 80.656,
      });
    }
  },

  async setOnline(online) {
    await wait();
    const p = db.providers.find((x) => x.id === uid()) ?? fail('Create your provider profile first');
    p.is_online = online;
  },

  async listMyServices(includeInactive = false): Promise<ProviderService[]> {
    await wait();
    const me = uid();
    return clone(
      db.services
        .filter((s) => s.provider_id === me && (includeInactive || s.active))
        .map((s) => ({ ...s, categories: categoryOf(s.category_id) })),
    );
  },

  async upsertService(input: ServiceInput) {
    await wait();
    const me = uid();
    assert(db.providers.some((p) => p.id === me), 'Create your provider profile first');
    const existing = db.services.find((s) => s.provider_id === me && s.category_id === input.categoryId);
    const fields = {
      skill_level: input.skillLevel,
      visit_fee: input.visitFee,
      labour_rate: input.labourRate,
      rate_unit: input.rateUnit,
      max_travel_km: input.maxTravelKm ?? null,
      travel_fee_mode: input.travelFeeMode ?? 'none',
      travel_fee_flat: input.travelFeeFlat ?? 0,
      travel_fee_per_km: input.travelFeePerKm ?? 0,
      active: true,
    };
    if (existing) Object.assign(existing, fields);
    else db.services.push({ id: newId('ps'), provider_id: me, category_id: input.categoryId, ...fields, rate_card_items: [] });
  },

  async deleteService(id) {
    await wait();
    const me = uid();
    // Same as the real backend: deactivate (bookings keep referencing the row).
    const s = db.services.find((x) => x.id === id && x.provider_id === me);
    if (s) s.active = false;
  },

  async addRateCardItem(providerServiceId, title, price) {
    await wait();
    const s = db.services.find((x) => x.id === providerServiceId && x.provider_id === uid()) ?? fail('Service not found');
    s.rate_card_items = [...(s.rate_card_items ?? []), { id: newId('rc'), provider_service_id: s.id, title, price }];
  },

  async getProviderJobs(): Promise<ProviderJob[]> {
    await wait();
    const me = uid();
    const p = db.providers.find((x) => x.id === me);
    return db.bookings
      .filter((b) => b.provider_id === me && b.status !== 'pending_payment')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((b) => ({
        booking_id: b.id,
        status: b.status,
        category_name: categoryOf(b.category_id)?.name ?? 'Service',
        customer_name: nameOf(b.customer_id),
        description: b.description,
        scheduled_at: b.scheduled_at,
        created_at: b.created_at,
        visit_fee: b.visit_fee,
        area: b.address.area,
        distance_km: p ? Math.round(haversineKm(p, b.address) * 10) / 10 : null,
        address_line: b.accepted_at ? b.address.line1 : null,
        lat: b.accepted_at ? b.address.lat : null,
        lng: b.accepted_at ? b.address.lng : null,
      }));
  },

  async listMyPayouts() {
    await wait();
    const me = uid();
    return clone(db.payouts.filter((p) => db.bookings.some((b) => b.id === p.booking_id && b.provider_id === me)).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },

  async listMessages(bookingId) {
    await wait();
    return clone(db.messages.filter((m) => m.booking_id === bookingId).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  },

  async sendMessage(bookingId, body) {
    await wait();
    const me = uid();
    const b = findBooking(bookingId);
    assert(b.customer_id === me || b.provider_id === me, 'not a participant');
    pushMessage(bookingId, me, body);
    const other = b.customer_id === me ? b.provider_id : b.customer_id;
    later(() => pushMessage(bookingId, other, AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)]!), 1800);
  },

  subscribeToMessages(bookingId, onMessage) {
    const set = messageListeners.get(bookingId) ?? new Set();
    set.add(onMessage);
    messageListeners.set(bookingId, set);
    return () => set.delete(onMessage);
  },

  subscribeToBooking(bookingId, onChange) {
    const set = bookingListeners.get(bookingId) ?? new Set();
    set.add(onChange);
    bookingListeners.set(bookingId, set);
    return () => set.delete(onChange);
  },

  subscribeToMyMessages(onMessage) {
    myMessageListeners.add(onMessage);
    return () => myMessageListeners.delete(onMessage);
  },

  async getUnreadCounts() {
    await wait();
    const me = uid();
    return db.bookings
      .filter((b) => b.customer_id === me || b.provider_id === me)
      .map((b) => {
        const since = chatReads[`${me}:${b.id}`] ?? '';
        const unread = db.messages.filter((m) => m.booking_id === b.id && m.sender_id !== me && m.created_at > since);
        return {
          booking_id: b.id,
          role: (b.customer_id === me ? 'customer' : 'provider') as 'customer' | 'provider',
          unread: unread.length,
          last_message_at: unread.reduce<string | null>((a, m) => (!a || m.created_at > a ? m.created_at : a), null),
        };
      })
      .filter((r) => r.unread > 0);
  },

  async markChatRead(bookingId) {
    const me = uid();
    const b = findBooking(bookingId);
    assert(b.customer_id === me || b.provider_id === me, 'not a participant of this booking');
    const now = nowIso();
    const key = `${me}:${bookingId}`;
    if (!chatReads[key] || chatReads[key]! < now) chatReads[key] = now;
  },

  async getChatReadState(bookingId) {
    const me = uid();
    const b = findBooking(bookingId);
    assert(b.customer_id === me || b.provider_id === me, 'not a participant of this booking');
    const other = b.customer_id === me ? b.provider_id : b.customer_id;
    return { my_last_read_at: chatReads[`${me}:${bookingId}`] ?? null, other_last_read_at: chatReads[`${other}:${bookingId}`] ?? null };
  },

  // Demo mode never registers for push (no backend to send from).
  async registerPushDevice() {},
  async unregisterPushDevice() {},
};

/** Simulates the Razorpay webhook for the booking's live payment link (called by the demo payment sheet). */
export async function completeDemoPayment(bookingId: string): Promise<void> {
  await wait();
  const b = findBooking(bookingId);
  assert(b.customer_id === uid(), 'only the customer can pay');
  recordPaid(b);
}

/** Test/dev hooks. */
export const demoControls = {
  reset(now?: number) {
    clearTimers();
    db = buildSeed(now);
    chatReads = {};
    session = null;
    sessionLoaded = true;
    bookingSeq = 1046;
  },
  setLatency(min: number, max: number) {
    latency = [min, max];
  },
  setAutopilot(on: boolean) {
    autopilot = on;
    if (!on) clearTimers();
  },
  signInForTests() {
    session = { userId: DEMO_USER_ID, phone: '+919876543210' };
    sessionLoaded = true;
  },
  db: () => db,
};


/** Read access for the demo provider-onboarding mirror (demo/demoOnboarding.ts); demo mode only. */
export const demoInternals = { db: (): DemoDb => db, uid: (): string => uid(), wait: (): Promise<void> => wait() };
