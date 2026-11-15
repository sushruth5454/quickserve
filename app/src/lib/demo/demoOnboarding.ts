/**
 * Demo-mode mirror of the provider onboarding API (in memory). Follows the same rules as migration 0009:
 * completeness checks, go-live rule, availability. Payout verification is simulated (activates after a short delay,
 * like Razorpay test mode) and documents are auto-approved after a delay. Never used when Supabase is configured.
 */
import type { ProviderService, RateUnit } from '../types';
import { validateSlots } from '../onboarding/availability';
import type {
  BasicsInput,
  Check,
  DocumentType,
  GoLive,
  GoLiveReason,
  MyProvider,
  OnboardingApi,
  OnboardingState,
  PayoutAccount,
  PortfolioPhoto,
  ProviderDocument,
  ProviderLink,
  ProviderSchedule,
  PublicProfile,
  TimeOff,
  WeeklySlot,
  CategorySkill,
} from '../onboarding/types';
import { validatePayoutForm } from '../onboarding/validation';
import { demoInternals } from './demoApi';

const TERMS = 'provider-agreement-v1-2026-11-14';

interface Extra {
  gender: MyProvider['gender'];
  base_area: string | null;
  max_jobs_per_day: number | null;
  paused: boolean;
  deactivated_at: string | null;
  onboarding_step: number;
  submitted_at: string | null;
  availability: WeeklySlot[];
  time_off: TimeOff[];
  portfolio: (PortfolioPhoto & { uri: string })[];
  documents: ProviderDocument[];
  payout: PayoutAccount | null;
  links: ProviderLink[];
}

const extras = new Map<string, Extra>();
let seq = 1;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

function extraFor(providerId: string): Extra {
  let e = extras.get(providerId);
  if (!e) {
    const p = demoInternals.db().providers.find((x) => x.id === providerId);
    const legacy = !!p && p.kyc_status === 'verified';
    e = {
      gender: null,
      base_area: null,
      max_jobs_per_day: null,
      paused: false,
      deactivated_at: null,
      onboarding_step: legacy ? 7 : 0,
      submitted_at: legacy ? p!.created_at : null,
      availability: [],
      time_off: [],
      portfolio: [],
      documents: [],
      links: [],
      payout: legacy ? { rail: 'payouts', activation_status: 'activated', beneficiary_name: null, bank_last4: '0000', ifsc: null, last_error: null, requirements: [] } : null,
    };
    extras.set(providerId, e);
  }
  return e;
}

const SKILLS: Record<string, [string, string][]> = {
  'ac-repair': [['split', 'Split AC'], ['window', 'Window AC'], ['inverter', 'Inverter AC'], ['gas-refill', 'Gas refill'], ['installation', 'Installation / uninstallation'], ['servicing', 'Jet / deep servicing']],
  electrician: [['wiring', 'House wiring'], ['fan', 'Fan installation / repair'], ['switchboard', 'Switchboards & sockets'], ['inverter', 'Inverter / UPS'], ['lights', 'Lights & fixtures']],
  plumber: [['leak', 'Leak repair'], ['tap', 'Taps & mixers'], ['blockage', 'Drain blockage'], ['toilet', 'Toilet / flush tank'], ['motor', 'Water motor / pump']],
};
const RATE_ITEMS: Record<string, string[]> = {
  'ac-repair': ['Gas refill (full)', 'Jet service', 'Split AC installation'],
  electrician: ['Ceiling fan installation', 'Switch / socket replacement'],
  plumber: ['Tap replacement', 'Drain blockage removal'],
};
const DOC_TYPES: DocumentType[] = [
  { code: 'police_verification', label: 'Police verification certificate', description: 'Issued in the last 12 months', has_expiry: true, sort_order: 1 },
  { code: 'electrical_licence', label: 'Electrical licence', description: 'State electrical licence', has_expiry: true, sort_order: 2 },
  { code: 'pest_control_licence', label: 'Pest control licence', description: 'Operator licence', has_expiry: true, sort_order: 3 },
  { code: 'trade_certificate', label: 'Training certificate', description: 'ITI / brand / skill training', has_expiry: false, sort_order: 6 },
  { code: 'other_certificate', label: 'Other certificate', description: 'Any other relevant certificate', has_expiry: false, sort_order: 7 },
];

function myServices(providerId: string): ProviderService[] {
  return demoInternals.db().services.filter((s) => s.provider_id === providerId);
}

function checks(providerId: string): Check[] {
  const db = demoInternals.db();
  const p = db.providers.find((x) => x.id === providerId)!;
  const pf = db.profiles.find((x) => x.id === providerId);
  const e = extraFor(providerId);
  const active = myServices(providerId).filter((s) => s.active);
  return [
    { key: 'name', required: true, ok: (pf?.full_name ?? '').trim().length >= 2 },
    { key: 'photo', required: true, ok: !!pf?.avatar_url },
    { key: 'bio', required: true, ok: p.bio.trim().length >= 30 },
    { key: 'languages', required: true, ok: p.languages.length >= 1 },
    { key: 'services', required: true, ok: active.length > 0 },
    { key: 'area', required: true, ok: p.city.trim() !== '' && e.base_area !== null },
    { key: 'hours', required: true, ok: e.availability.length > 0 },
    { key: 'specialisations', required: false, ok: active.length > 0 && active.every((s) => ((s as ProviderService & { specialisations?: string[] }).specialisations ?? []).length > 0) },
    { key: 'portfolio', required: false, ok: e.portfolio.length >= 3 },
    { key: 'payout', required: false, ok: !!e.payout },
  ];
}

function goLive(providerId: string): GoLive {
  const p = demoInternals.db().providers.find((x) => x.id === providerId)!;
  const e = extraFor(providerId);
  const reasons: GoLiveReason[] = [];
  if (p.kyc_status !== 'verified') {
    if (!e.payout) reasons.push({ code: 'payout_missing', severity: 'action' });
    else if (e.payout.activation_status === 'needs_clarification') reasons.push({ code: 'payout_needs_clarification', severity: 'action', detail: e.payout.requirements[0]?.description });
    else reasons.push({ code: 'payout_pending', severity: 'wait' });
  }
  const live = p.kyc_status === 'verified' && !p.suspended && !e.deactivated_at && !!e.submitted_at && myServices(providerId).some((s) => s.active);
  const state = e.deactivated_at
    ? 'deactivated'
    : p.suspended
      ? 'suspended'
      : !e.submitted_at
        ? 'draft'
        : live
          ? 'live'
          : reasons.some((r) => r.severity === 'action')
            ? 'action_needed'
            : 'under_review';
  return { state, reasons, paused: e.paused, live, submitted_at: e.submitted_at };
}

function state(providerId: string): OnboardingState {
  const db = demoInternals.db();
  const p = db.providers.find((x) => x.id === providerId);
  const pf = db.profiles.find((x) => x.id === providerId);
  if (!p) {
    return {
      provider: null,
      profile: pf ? { full_name: pf.full_name, avatar_url: pf.avatar_url } : null,
      payout: null,
      documents: [],
      availability: [],
      time_off: [],
      portfolio: [],
      checks: [],
      go_live: { state: 'draft', reasons: [], paused: false },
      terms_version: TERMS,
    };
  }
  const e = extraFor(providerId);
  const provider: MyProvider = {
    ...p,
    gender: e.gender,
    timezone: 'Asia/Kolkata',
    base_area: e.base_area,
    max_jobs_per_day: e.max_jobs_per_day,
    paused: e.paused,
    deactivated_at: e.deactivated_at,
    onboarding_step: e.onboarding_step,
    submitted_at: e.submitted_at,
    terms_version: e.submitted_at ? TERMS : null,
    kyc_reason: null,
    review_note: null,
  };
  return {
    provider,
    profile: pf ? { full_name: pf.full_name, avatar_url: pf.avatar_url } : null,
    payout: e.payout,
    documents: e.documents,
    availability: e.availability,
    time_off: e.time_off.filter((t) => new Date(t.to).getTime() > Date.now()),
    portfolio: e.portfolio.map(({ uri, ...rest }) => ({ ...rest, file_path: uri })),
    checks: checks(providerId),
    go_live: goLive(providerId),
    terms_version: TERMS,
  };
}

function requireProvider() {
  const me = demoInternals.uid();
  const p = demoInternals.db().providers.find((x) => x.id === me);
  if (!p) throw new Error('Create your provider profile first');
  return { me, p, e: extraFor(me) };
}

const istMidnight = (d: string) => new Date(`${d}T00:00:00+05:30`);

export const demoOnboardingApi: OnboardingApi = {
  async getOnboarding() {
    await demoInternals.wait();
    return JSON.parse(JSON.stringify(state(demoInternals.uid()))) as OnboardingState;
  },

  async getCatalog() {
    await demoInternals.wait();
    const db = demoInternals.db();
    const skills: CategorySkill[] = [];
    for (const c of db.categories) {
      (SKILLS[c.slug] ?? []).forEach(([slug, label], i) => skills.push({ id: `${c.id}-s-${slug}`, category_id: c.id, kind: 'skill', slug, label, sort_order: i }));
      (RATE_ITEMS[c.slug] ?? []).forEach((label, i) => skills.push({ id: `${c.id}-r-${i}`, category_id: c.id, kind: 'rate_item', slug: `r${i}`, label, sort_order: i }));
    }
    return { skills, docTypes: DOC_TYPES };
  },

  async saveBasics(input: BasicsInput) {
    await demoInternals.wait();
    const me = demoInternals.uid();
    const db = demoInternals.db();
    const pf = db.profiles.find((x) => x.id === me);
    if (pf) {
      pf.full_name = input.fullName.trim();
      pf.role_provider = true;
      if (input.avatarUrl) pf.avatar_url = input.avatarUrl;
    }
    let p = db.providers.find((x) => x.id === me);
    if (!p) {
      p = {
        id: me, bio: '', city: '', service_radius_km: 10, years_experience: 0, languages: [], kyc_status: 'pending', suspended: false,
        is_online: false, rating_avg: 0, rating_count: 0, jobs_completed: 0, commission_tier: 12, razorpay_account_id: null,
        created_at: new Date().toISOString(), lat: 0, lng: 0,
      };
      db.providers.push(p);
    }
    Object.assign(p, { bio: input.bio.trim(), years_experience: input.yearsExperience, languages: input.languages });
    const e = extraFor(me);
    e.gender = input.gender;
    e.onboarding_step = Math.max(e.onboarding_step, 1);
  },

  async uploadAvatar(uri) {
    await demoInternals.wait();
    return uri;
  },

  async saveServiceArea(input) {
    await demoInternals.wait();
    const { p, e } = requireProvider();
    Object.assign(p, { city: input.city.trim(), lat: input.lat, lng: input.lng, service_radius_km: input.radiusKm });
    e.base_area = input.areaName?.trim() || input.city.trim();
    e.onboarding_step = Math.max(e.onboarding_step, 3);
  },

  async saveService(input) {
    await demoInternals.wait();
    const { me } = requireProvider();
    const db = demoInternals.db();
    const existing = db.services.find((s) => s.provider_id === me && s.category_id === input.categoryId);
    const cat = db.categories.find((c) => c.id === input.categoryId);
    const fields = {
      skill_level: input.skillLevel, visit_fee: input.visitFee, labour_rate: input.labourRate, rate_unit: input.rateUnit, active: true,
      specialisations: input.specialisations, brands: input.brands, tools: input.tools, attributes: input.attributes,
      max_travel_km: input.maxTravelKm, travel_fee_mode: input.travelFeeMode,
      travel_fee_flat: input.travelFeeFlat, travel_fee_per_km: input.travelFeePerKm,
    };
    if (existing) Object.assign(existing, fields);
    else db.services.push({ id: id('ps'), provider_id: me, category_id: input.categoryId, categories: cat ? { name: cat.name, slug: cat.slug } : null, rate_card_items: [], ...fields } as ProviderService);
  },

  async saveServicePackage(packageId, providerServiceId, input) {
    await demoInternals.wait();
    const service = myServices(requireProvider().me).find((candidate) => candidate.id === providerServiceId);
    if (!service) throw new Error('Service not found.');
    const packages = service.service_packages ?? [];
    const existing = packages.find((candidate) => candidate.id === packageId);
    const now = new Date().toISOString();
    if (existing) { Object.assign(existing, input, { updated_at: now }); return existing.id; }
    const newId = id('pkg');
    service.service_packages = [...packages, { id: newId, provider_service_id: providerServiceId, package_template_id: null, ...input, created_at: now, updated_at: now }];
    return newId;
  },
  async deleteServicePackage(packageId) {
    await demoInternals.wait();
    for (const service of myServices(requireProvider().me)) service.service_packages = (service.service_packages ?? []).filter((candidate) => candidate.id !== packageId);
  },

  async deleteRateCardItem(itemId) {
    await demoInternals.wait();
    for (const s of demoInternals.db().services) s.rate_card_items = (s.rate_card_items ?? []).filter((r) => r.id !== itemId);
  },

  async listProviderLinks() {
    const { me, e } = requireProvider();
    return e.links.filter((x) => x.provider_id === me).map((x) => ({ ...x }));
  },

  async saveProviderLink(input) {
    await demoInternals.wait();
    const { me, e } = requireProvider();
    const existing = e.links.find((x) => x.kind === input.kind);
    if (existing) Object.assign(existing, { url: input.url.trim(), handle: input.handle?.trim() || null });
    else
      e.links.push({
        id: id('link'),
        provider_id: me,
        kind: input.kind,
        url: input.url.trim(),
        handle: input.handle?.trim() || null,
        verified_method: 'none',
        stats: {},
        stats_synced_at: null,
        status: 'pending',
        review_reason: null,
        reviewed_by: null,
        reviewed_at: null,
      });
  },

  async deleteProviderLink(linkId) {
    const { me, e } = requireProvider();
    e.links = e.links.filter((x) => x.id !== linkId || x.provider_id !== me);
  },

  async getPriceGuidance(_categoryId: string, _city: string, _unit: RateUnit) {
    await demoInternals.wait();
    // Demo data is synthetic, so never present it as local market data.
    return { visit_fee: null, labour_rate: null, min_points: 5 };
  },

  async setStep(step) {
    const { e } = requireProvider();
    e.onboarding_step = Math.max(e.onboarding_step, step);
  },

  async setAvailability(slots, maxJobsPerDay) {
    await demoInternals.wait();
    const err = validateSlots(slots);
    if (err) throw new Error(err);
    const { e } = requireProvider();
    e.availability = slots;
    e.max_jobs_per_day = maxJobsPerDay;
    e.onboarding_step = Math.max(e.onboarding_step, 4);
  },

  async addTimeOff(from, to, reason) {
    await demoInternals.wait();
    if (to < from) throw new Error('End date must be on or after start date');
    const { e } = requireProvider();
    const end = istMidnight(to);
    end.setUTCDate(end.getUTCDate() + 1);
    e.time_off.push({ id: id('to'), from: istMidnight(from).toISOString(), to: end.toISOString(), reason });
  },

  async deleteTimeOff(timeOffId) {
    await demoInternals.wait();
    const { e } = requireProvider();
    e.time_off = e.time_off.filter((t) => t.id !== timeOffId);
  },

  async addPortfolioPhoto(uri, _mime, caption) {
    await demoInternals.wait();
    const { e } = requireProvider();
    if (e.portfolio.length >= 12) throw new Error('At most 12 work photos');
    e.portfolio.push({ id: id('pf'), file_path: uri, uri, caption });
  },

  async updatePortfolioCaption(photoId, caption) {
    const { e } = requireProvider();
    const ph = e.portfolio.find((x) => x.id === photoId);
    if (ph) ph.caption = caption;
  },

  async deletePortfolioPhoto(photoId) {
    await demoInternals.wait();
    const { e } = requireProvider();
    e.portfolio = e.portfolio.filter((x) => x.id !== photoId);
  },

  async uploadDocument(docType, _uri, _mime, categoryId, expiresOn) {
    await demoInternals.wait();
    const { e } = requireProvider();
    const doc: ProviderDocument = { id: id('doc'), doc_type: docType, category_id: categoryId, status: 'pending', reject_reason: null, expires_on: expiresOn, created_at: new Date().toISOString() };
    e.documents.unshift(doc);
    setTimeout(() => {
      doc.status = 'approved';
    }, 4000);
  },

  async submitPayout(form) {
    await demoInternals.wait();
    const fields = validatePayoutForm(form, 'payouts');
    if (Object.keys(fields).length) return { rail: 'payouts', state: 'not_started', error: 'Please fix the highlighted fields.', fields };
    const { p, e } = requireProvider();
    const acc = form.account_number.replace(/\s+/g, '');
    e.payout = { rail: 'payouts', activation_status: 'under_review', beneficiary_name: form.legal_name.trim(), bank_last4: acc.slice(-4), ifsc: form.ifsc.toUpperCase(), last_error: null, requirements: [], fund_account_id: 'fa_demo' };
    p.kyc_status = 'under_review';
    setTimeout(() => {
      if (e.payout) e.payout.activation_status = 'activated';
      p.kyc_status = 'verified';
    }, 3000);
    return { rail: 'payouts', state: 'submitted', gateway_status: 'under_review', kyc_status: 'under_review' };
  },

  async refreshPayout() {
    await demoInternals.wait();
    return { rail: 'payouts', state: 'updated' };
  },

  async payoutRail() {
    return 'payouts';
  },

  async submitProfile(termsVersion) {
    await demoInternals.wait();
    if (termsVersion !== TERMS) throw new Error('Please accept the latest provider agreement');
    const { me, e } = requireProvider();
    const missing = checks(me).filter((c) => c.required && !c.ok).map((c) => c.key);
    if (missing.length) throw new Error(`Profile incomplete: ${missing.join(', ')}`);
    e.submitted_at = e.submitted_at ?? new Date().toISOString();
    e.onboarding_step = 7;
    return goLive(me);
  },

  async setPaused(paused) {
    await demoInternals.wait();
    const { p, e } = requireProvider();
    e.paused = paused;
    if (paused) p.is_online = false;
  },

  async deactivate() {
    await demoInternals.wait();
    const { p, e } = requireProvider();
    e.deactivated_at = new Date().toISOString();
    e.paused = true;
    p.is_online = false;
  },

  async reactivate() {
    await demoInternals.wait();
    const { e } = requireProvider();
    e.deactivated_at = null;
    e.paused = false;
  },

  async getPublicProfile(providerId): Promise<PublicProfile | null> {
    await demoInternals.wait();
    const p = demoInternals.db().providers.find((x) => x.id === providerId);
    if (!p) return null;
    const e = extraFor(providerId);
    const verified = p.kyc_status === 'verified';
    return {
      id: p.id,
      base_area: e.base_area,
      city: p.city,
      service_radius_km: p.service_radius_km,
      paused: e.paused,
      live: goLive(providerId).live ?? verified,
      member_since: p.created_at,
      badges: { id_verified: verified && (p.razorpay_account_id ?? '').startsWith('acc_'), payout_verified: verified, police_verified: e.documents.some((d) => d.doc_type === 'police_verification' && d.status === 'approved') },
      credentials: e.documents.filter((d) => d.status === 'approved').map((d) => DOC_TYPES.find((t) => t.code === d.doc_type)?.label ?? d.doc_type),
      specialisations: myServices(providerId).filter((s) => s.active).map((s) => {
        const cat = demoInternals.db().categories.find((c) => c.id === s.category_id);
        const chosen = (s as ProviderService & { specialisations?: string[] }).specialisations ?? [];
        return {
          category_id: s.category_id,
          labels: (SKILLS[cat?.slug ?? ''] ?? []).filter(([slug]) => chosen.includes(slug)).map(([, l]) => l),
          brands: (s as ProviderService & { brands?: string[] }).brands ?? [],
          attributes: s.attributes ?? {},
          schema: { type: 'object' as const, properties: {} },
        };
      }),
      hours: e.availability,
      on_leave_until: e.time_off.find((t) => new Date(t.from).getTime() <= Date.now() && Date.now() < new Date(t.to).getTime())?.to ?? null,
      portfolio: e.portfolio.map((x) => ({ file_path: x.uri, caption: x.caption })),
      links: e.links.map((x) => ({
        id: x.id,
        kind: x.kind,
        url: x.url,
        handle: x.handle,
        verified: x.verified_method !== 'none',
        verified_method: x.verified_method,
        stats: x.stats,
        stats_synced_at: x.stats_synced_at,
        status: x.status,
        review_reason: x.review_reason,
      })),
      review_themes: [],
    };
  },

  async getProviderSchedule(providerId): Promise<ProviderSchedule | null> {
    const p = demoInternals.db().providers.find((x) => x.id === providerId);
    if (!p) return null;
    const e = extraFor(providerId);
    return { timezone: 'Asia/Kolkata', paused: e.paused, max_jobs_per_day: e.max_jobs_per_day, slots: e.availability, time_off: e.time_off.map((t) => ({ from: t.from, to: t.to })), full_days: [] };
  },

  publicUrl(_bucket, path) {
    return path;
  },
};
