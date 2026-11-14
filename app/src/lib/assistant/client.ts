/**
 * Assistant transport: the ai-assistant edge function, or the scripted offline assistant in demo mode
 * (EXPO_PUBLIC_DEMO_MODE / missing Supabase env only; production never loads demo data).
 *
 * Chat requests ask for server-sent events: real progress stages stream in as the server works, then the final reply.
 * If the platform cannot stream (no readable body) or the server answers with JSON, the same request is read in one
 * piece and the UI shows a generic "Working on it…" instead of a step list. Nothing is ever re-sent automatically.
 */
import { fetch as streamingFetch } from 'expo/fetch';
import { isDemoMode } from '../config';
import { demoAssistant } from '../demo/demoAssistant';
import { supabase } from '../supabase';
import { parseAssistantReply, parseTranscription } from './parse';
import { abortError, AssistantError, linkedAbort, readEventStream, toError, type SendOptions } from './stream';
import type { AssistantReply, AssistantRequest, Transcription } from './types';

export { AssistantError, type SendOptions };

/** Client-side wait; the function itself gives up on the model after its request budget with a friendly error. */
const CLIENT_TIMEOUT_MS = 65_000;
const TRANSCRIBE_TIMEOUT_MS = 40_000;

const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/ai-assistant`;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AssistantError('Please sign in again.', 'unauthorized', 'auth');
  return { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' };
}

export function requestBody(req: AssistantRequest) {
  return {
    conversation_id: req.conversationId,
    message: req.message ?? '',
    location: req.location,
    ...(req.audio ? { audio: { data: req.audio.data, mime_type: req.audio.mimeType } } : {}),
    ...(req.voice ? { voice: req.voice } : {}),
    ...(req.image ? { image: { data: req.image.data, mime_type: req.image.mimeType } } : {}),
  };
}

async function callStreaming(req: AssistantRequest, opts: SendOptions): Promise<AssistantReply> {
  const headers = await authHeaders();
  const abort = linkedAbort(opts.signal, CLIENT_TIMEOUT_MS);
  try {
    const res = await streamingFetch(FUNCTION_URL, {
      method: 'POST',
      headers: { ...headers, Accept: 'text/event-stream' },
      body: JSON.stringify(requestBody(req)),
      signal: abort.signal,
    });
    if (!res.ok) throw toError(res.status, await res.json().catch(() => null));
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      opts.onStreamUnavailable?.();
      return parseAssistantReply(await res.json());
    }
    return await readEventStream(res.body as never, () => res.text(), opts);
  } catch (e) {
    if (abort.signal.aborted) throw abortError(abort);
    if (e instanceof AssistantError) throw e;
    throw toError(null, null);
  } finally {
    abort.done();
  }
}

export function sendToAssistant(req: AssistantRequest, opts: SendOptions = {}): Promise<AssistantReply> {
  if (isDemoMode) {
    opts.onStreamUnavailable?.();
    return demoAssistant(req);
  }
  return callStreaming(req, opts);
}

/** Voice step 1: transcript (+ English) for the customer to review/edit before it is sent. The audio is not stored. */
export async function transcribeVoice(audio: { data: string; mimeType: string }, signal?: AbortSignal): Promise<Transcription> {
  if (isDemoMode) throw new AssistantError('Voice is not available in demo mode. Please type instead.', 'voice_disabled', 'disabled');
  const headers = await authHeaders();
  const abort = linkedAbort(signal, TRANSCRIBE_TIMEOUT_MS);
  try {
    const res = await streamingFetch(FUNCTION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'transcribe', audio: { data: audio.data, mime_type: audio.mimeType } }),
      signal: abort.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw toError(res.status, body);
    return parseTranscription(body);
  } catch (e) {
    if (abort.signal.aborted) throw abortError(abort);
    if (e instanceof AssistantError) throw e;
    throw toError(null, null);
  } finally {
    abort.done();
  }
}
