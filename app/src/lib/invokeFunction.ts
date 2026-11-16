import type { FunctionInvokeOptions } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const SESSION_EXPIRED_MESSAGE = 'Your login has expired. Please sign in again.';

const isUnauthorized = (error: unknown) => (error as { context?: Response } | null)?.context?.status === 401;

/**
 * supabase.functions.invoke with one recovery step: functions verify the login session server-side, so a token whose
 * session has ended (signed out on another device, refresh rotated) gets 401 while plain table reads still work. Refresh
 * once and retry; if the session cannot be refreshed, report it as an expired login instead of a raw "unauthorized".
 */
export async function invokeFunction<T>(name: string, options: FunctionInvokeOptions) {
  const first = await supabase.functions.invoke<T>(name, options);
  if (!isUnauthorized(first.error)) return first;
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) return { data: null, error: new Error(SESSION_EXPIRED_MESSAGE), response: undefined };
  const retry = await supabase.functions.invoke<T>(name, options);
  if (isUnauthorized(retry.error)) return { data: null, error: new Error(SESSION_EXPIRED_MESSAGE), response: undefined };
  return retry;
}
