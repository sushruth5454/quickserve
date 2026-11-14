/**
 * Assistant transport: the ai-assistant edge function, or the scripted offline assistant in demo mode
 * (EXPO_PUBLIC_DEMO_MODE / missing Supabase env only; production never loads demo data).
 */
import { isDemoMode } from '../config';
import { demoAssistant } from '../demo/demoAssistant';
import { supabase } from '../supabase';
import { mapAssistantError, parseAssistantReply, type AssistantErrorKind } from './parse';
import type { AssistantReply, AssistantRequest } from './types';

/** Client-side wait; the function itself gives up on the model after its request budget with a friendly error. */
const CLIENT_TIMEOUT_MS = 65_000;

export class AssistantError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly kind: AssistantErrorKind,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

async function callFunction(req: AssistantRequest): Promise<AssistantReply> {
  const body = {
    conversation_id: req.conversationId,
    message: req.message ?? '',
    location: req.location,
    ...(req.audio ? { audio: { data: req.audio.data, mime_type: req.audio.mimeType } } : {}),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AssistantError('That took too long. Please try again.', 'timeout', 'retry')), CLIENT_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([supabase.functions.invoke('ai-assistant', { body }), timeout]);
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const status = ctx && typeof ctx.status === 'number' ? ctx.status : null;
      const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      const m = mapAssistantError(status, detail);
      throw new AssistantError(m.message, m.code, m.kind, m.requestId);
    }
    return parseAssistantReply(data);
  } catch (e) {
    if (e instanceof AssistantError) throw e;
    const m = mapAssistantError(null, null);
    throw new AssistantError(m.message, m.code, m.kind);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function sendToAssistant(req: AssistantRequest): Promise<AssistantReply> {
  return isDemoMode ? demoAssistant(req) : callFunction(req);
}
