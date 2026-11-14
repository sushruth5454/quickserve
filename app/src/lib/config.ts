const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const demoFlag = process.env.EXPO_PUBLIC_DEMO_MODE ?? '';

export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

/**
 * Demo mode runs the whole app against an in-memory mock backend (src/lib/demo) with seed data.
 * On when EXPO_PUBLIC_DEMO_MODE=1/true, or automatically when Supabase env vars are missing.
 */
export const isDemoMode = /^(1|true|yes)$/i.test(demoFlag.trim()) || !isSupabaseConfigured;

/**
 * Testing aid: EXPO_PUBLIC_FORCE_TEST_LOCATION=1 makes the Vijayawada test area (where the seed data lives) the
 * initial customer location instead of asking for GPS on first run. It is only a default: the user can still change
 * the location from the picker. (The provider onboarding base location is still pinned.)
 */
export const forceTestLocation = /^(1|true|yes)$/i.test((process.env.EXPO_PUBLIC_FORCE_TEST_LOCATION ?? '').trim());

/** QuickServe AI entry points (Home card, category button, /assistant). On unless EXPO_PUBLIC_AI_ASSISTANT=0/false/off.
 * The server has its own kill switch (AI_ASSISTANT_ENABLED); this flag only hides the UI. */
export const aiAssistantEnabled = !/^(0|false|no|off)$/i.test((process.env.EXPO_PUBLIC_AI_ASSISTANT ?? '').trim());

/**
 * Human support contacts for the assistant's "Talk to support" handoff. Email defaults to the address already shown in
 * the app's terms/privacy screens; phone/WhatsApp are shown only when configured (digits only, with country code).
 */
export const supportContact = {
  email: (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '').trim() || 'support@quickserve.app',
  phone: (process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '').replace(/[^\d+]/g, '') || null,
  whatsapp: (process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '') || null,
};
