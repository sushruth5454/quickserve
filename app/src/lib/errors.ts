type FriendlyErrorKey = 'error.generic' | 'error.network' | 'error.signIn' | 'ai.busy';

export function friendlyError(e: unknown): { key: FriendlyErrorKey; raw: string } {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === 'string'
        ? e
        : typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string'
          ? e.message
          : String(e);

  let key: FriendlyErrorKey = 'error.generic';
  if (/network|fetch failed|Failed to fetch/i.test(raw)) {
    key = 'error.network';
  } else if (/JWT|not authenticated|401/i.test(raw)) {
    key = 'error.signIn';
  } else if (/429|rate limit/i.test(raw)) {
    key = 'ai.busy';
  }

  return { key, raw };
}
