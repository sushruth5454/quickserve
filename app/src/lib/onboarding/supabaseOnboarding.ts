/** Supabase implementation of the provider onboarding API (migrations 0009/0011, Edge Function provider-payout-account). */
import { supabase } from '../supabase';
import type {
  BasicsInput,
  CategorySkill,
  DocumentType,
  GoLive,
  OnboardingApi,
  OnboardingState,
  PayoutFieldErrors,
  PayoutForm,
  PayoutResult,
  ProviderLink,
  ProviderLinkInput,
  PriceGuidance,
  ProviderSchedule,
  PublicProfile,
  ServiceAreaInput,
  ServiceDetailsInput,
  WeeklySlot,
} from './types';

interface Res<T> {
  data?: T | null;
  error: { message: string } | null;
}

function unwrap<T>(res: Res<T>): T {
  if (res.error) throw new Error(friendlyDbError(res.error.message));
  return res.data as T;
}

/** Strips Postgres prefixes ("provider_unavailable: …") and makes the first letter uppercase. */
export function friendlyDbError(message: string): string {
  const m = message.replace(/^[a-z_]+: /, '');
  return m.charAt(0).toUpperCase() + m.slice(1);
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

const ext = (mime: string) => (mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

async function upload(bucket: string, uri: string, mimeType: string): Promise<string> {
  const me = await uid();
  const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext(mimeType)}`;
  const body = await (await fetch(uri)).arrayBuffer();
  unwrap(await supabase.storage.from(bucket).upload(path, body, { contentType: mimeType, upsert: false }));
  return path;
}

async function invokePayout(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke<Record<string, unknown>>('provider-payout-account', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx ? ((await ctx.json().catch(() => null)) as Record<string, unknown> | null) : null;
    if (detail?.fields) return { error: detail.error, fields: detail.fields };
    throw new Error((detail?.error as string | undefined) ?? error.message);
  }
  return data ?? {};
}

const EMPTY_GO_LIVE: GoLive = { state: 'draft', reasons: [], paused: false };

export const supabaseOnboardingApi: OnboardingApi = {
  async getOnboarding(): Promise<OnboardingState> {
    const raw = unwrap(await supabase.rpc('get_my_provider_onboarding')) as Partial<OnboardingState> | null;
    return {
      provider: raw?.provider ?? null,
      profile: raw?.profile ?? null,
      payout: raw?.payout ?? null,
      documents: raw?.documents ?? [],
      availability: raw?.availability ?? [],
      time_off: raw?.time_off ?? [],
      portfolio: raw?.portfolio ?? [],
      checks: raw?.checks ?? [],
      go_live: raw?.go_live ?? EMPTY_GO_LIVE,
      terms_version: raw?.terms_version ?? '',
    };
  },

  async getCatalog() {
    const [skills, docTypes] = await Promise.all([
      supabase.from('category_skills').select('id, category_id, kind, slug, label, sort_order').order('sort_order'),
      supabase.from('document_types').select('code, label, description, has_expiry, sort_order').order('sort_order'),
    ]);
    return { skills: unwrap(skills) as CategorySkill[], docTypes: unwrap(docTypes) as DocumentType[] };
  },

  async saveBasics(input: BasicsInput) {
    unwrap(
      await supabase.rpc('save_provider_basics', {
        p_full_name: input.fullName,
        p_avatar_url: input.avatarUrl,
        p_gender: input.gender,
        p_languages: input.languages,
        p_years_experience: input.yearsExperience,
        p_bio: input.bio,
      }),
    );
  },

  async uploadAvatar(uri, mimeType) {
    const path = await upload('avatars', uri, mimeType);
    return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  },

  async saveServiceArea(input: ServiceAreaInput) {
    unwrap(
      await supabase.rpc('save_provider_service_area', {
        p_city: input.city,
        p_lat: input.lat,
        p_lng: input.lng,
        p_radius_km: input.radiusKm,
        p_area_name: input.areaName,
      }),
    );
  },

  async saveService(input: ServiceDetailsInput) {
    const me = await uid();
    unwrap(
      await supabase.from('provider_services').upsert(
        {
          provider_id: me,
          category_id: input.categoryId,
          skill_level: input.skillLevel,
          visit_fee: input.visitFee,
          labour_rate: input.labourRate,
          rate_unit: input.rateUnit,
          specialisations: input.specialisations,
          brands: input.brands,
          tools: input.tools,
          attributes: input.attributes,
          max_travel_km: input.maxTravelKm,
          travel_fee_mode: input.travelFeeMode,
          travel_fee_flat: input.travelFeeFlat,
          travel_fee_per_km: input.travelFeePerKm,
          active: true,
        },
        { onConflict: 'provider_id,category_id' },
      ),
    );
  },

  async listProviderLinks(): Promise<ProviderLink[]> {
    const me = await uid();
    return unwrap(
      await supabase.from('provider_links').select('*').eq('provider_id', me).order('created_at', { ascending: true }),
    ) as ProviderLink[];
  },

  async saveProviderLink(input: ProviderLinkInput) {
    unwrap(await supabase.rpc('save_provider_link', { p_kind: input.kind, p_url: input.url.trim(), p_handle: input.handle?.trim() || null }));
  },

  async deleteProviderLink(id) {
    const me = await uid();
    unwrap(await supabase.from('provider_links').delete().eq('id', id).eq('provider_id', me));
  },

  async deleteRateCardItem(id) {
    unwrap(await supabase.from('rate_card_items').delete().eq('id', id));
  },

  async getPriceGuidance(categoryId, city, unit): Promise<PriceGuidance> {
    return unwrap(await supabase.rpc('get_local_price_guidance', { p_category_id: categoryId, p_city: city, p_rate_unit: unit })) as PriceGuidance;
  },

  async setStep(step) {
    unwrap(await supabase.rpc('set_provider_onboarding_step', { p_step: step }));
  },

  async setAvailability(slots: WeeklySlot[], maxJobsPerDay) {
    unwrap(await supabase.rpc('set_provider_availability', { p_slots: slots, p_max_jobs_per_day: maxJobsPerDay }));
  },

  async addTimeOff(from, to, reason) {
    unwrap(await supabase.rpc('add_provider_time_off', { p_from: from, p_to: to, p_reason: reason }));
  },

  async deleteTimeOff(id) {
    unwrap(await supabase.rpc('delete_provider_time_off', { p_id: id }));
  },

  async addPortfolioPhoto(uri, mimeType, caption) {
    const path = await upload('portfolio', uri, mimeType);
    const res = await supabase.rpc('add_portfolio_photo', { p_file_path: path, p_caption: caption });
    if (res.error) {
      await supabase.storage.from('portfolio').remove([path]);
      throw new Error(friendlyDbError(res.error.message));
    }
  },

  async updatePortfolioCaption(id, caption) {
    unwrap(await supabase.rpc('update_portfolio_caption', { p_id: id, p_caption: caption }));
  },

  async deletePortfolioPhoto(id) {
    const path = unwrap(await supabase.rpc('delete_portfolio_photo', { p_id: id })) as string;
    await supabase.storage.from('portfolio').remove([path]);
  },

  async uploadDocument(docType, uri, mimeType, categoryId, expiresOn) {
    const path = await upload('provider-docs', uri, mimeType);
    unwrap(
      await supabase.rpc('submit_provider_document', {
        p_doc_type: docType,
        p_file_path: path,
        p_category_id: categoryId,
        p_expires_on: expiresOn,
      }),
    );
  },

  async submitPayout(form: PayoutForm) {
    const res = await invokePayout({ action: 'submit', ...form });
    return res as unknown as PayoutResult & { fields?: PayoutFieldErrors; error?: string };
  },

  async refreshPayout() {
    return (await invokePayout({ action: 'refresh' })) as unknown as PayoutResult;
  },

  async payoutRail() {
    const res = await invokePayout({ action: 'status' });
    return res.rail === 'route' ? 'route' : 'payouts';
  },

  async submitProfile(termsVersion) {
    return unwrap(await supabase.rpc('submit_provider_profile', { p_terms_version: termsVersion })) as GoLive;
  },

  async setPaused(paused) {
    unwrap(await supabase.rpc('set_provider_paused', { p_paused: paused }));
  },

  async deactivate(reason) {
    unwrap(await supabase.rpc('deactivate_provider_account', { p_reason: reason }));
  },

  async reactivate() {
    unwrap(await supabase.rpc('reactivate_provider_account'));
  },

  async getPublicProfile(providerId): Promise<PublicProfile | null> {
    return unwrap(await supabase.rpc('get_provider_public_profile', { p_provider_id: providerId })) as PublicProfile | null;
  },

  async getProviderSchedule(providerId): Promise<ProviderSchedule | null> {
    return unwrap(await supabase.rpc('get_provider_availability', { p_provider_id: providerId })) as ProviderSchedule | null;
  },

  publicUrl(bucket, path) {
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  },
};
