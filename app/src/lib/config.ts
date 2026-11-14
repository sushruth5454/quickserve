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
 * Testing aid: EXPO_PUBLIC_FORCE_TEST_LOCATION=1 pins the device location to the Vijayawada test area
 * (where the seed data lives) instead of using GPS. Never set this for store builds.
 */
export const forceTestLocation = /^(1|true|yes)$/i.test((process.env.EXPO_PUBLIC_FORCE_TEST_LOCATION ?? '').trim());
