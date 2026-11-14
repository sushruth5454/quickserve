/**
 * Assistant transport: the ai-assistant edge function, or the scripted offline assistant in demo mode.
 */
import { isDemoMode } from '../config';
import { demoAssistant } from '../demo/demoAssistant';
import { supabase } from '../supabase';
import { parseAssistantReply } from './parse';
import type { AssistantReply, AssistantRequest } from './types';

/** Client-side wait; the function itself gives up on the model after ~50 s with a friendly error. */
const CLIENT_TIMEOUT_MS = 65_000;

export class AssistantError extends Error {
  constructor(
    message: string,
    readonly code: string,
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
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new AssistantError('That took too long. Please try again.', 'timeout')), CLIENT_TIMEOUT_MS),
  );
  const { data, error } = await Promise.race([supabase.functions.invoke('ai-assistant', { body }), timeout]);
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = (ctx ? await ctx.json().catch(() => null) : null) as { error?: string; code?: string } | null;
    throw new AssistantError(detail?.error ?? 'QuickServe AI is unavailable right now. Please try again.', detail?.code ?? 'network');
  }
  return parseAssistantReply(data);
}

export function sendToAssistant(req: AssistantRequest): Promise<AssistantReply> {
  return isDemoMode ? demoAssistant(req) : callFunction(req);
}

/** Voice input needs native recording + a real backend; web and demo mode are text-only. */
export const assistantSupportsVoice = (platform: string) => platform !== 'web' && !isDemoMode;
