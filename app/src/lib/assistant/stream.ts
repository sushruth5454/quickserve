/**
 * Pure stream helpers for the assistant client (no network/Supabase imports, so they are unit-tested in Jest):
 * the error type, Stop/timeout signal linking, and reading a server-sent-events body into stage callbacks + the final reply.
 */
import { mapAssistantError, parseAssistantReply, parseStageEvent, type AssistantErrorKind } from './parse';
import { createSseParser } from './sse';
import type { AssistantReply, StageEvent } from './types';
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

export interface SendOptions {
  /** Aborts the request (Stop button). The promise then rejects with kind 'stopped'. */
  signal?: AbortSignal;
  onStage?: (e: StageEvent) => void;
  onStart?: (info: { requestId: string | null; conversationId: string | null }) => void;
  /** The response could not be streamed; show a generic working state. */
  onStreamUnavailable?: () => void;
}

export function toError(status: number | null, detail: unknown): AssistantError {
  const m = mapAssistantError(status, detail);
  return new AssistantError(m.message, m.code, m.kind, m.requestId);
}

/** Own timeout + caller's Stop as one signal; tells them apart afterwards. */
export function linkedAbort(outer: AbortSignal | undefined, timeoutMs: number) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  outer?.addEventListener('abort', onAbort);
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

export function abortError(abort: ReturnType<typeof linkedAbort>): AssistantError {
  return abort.timedOut()
    ? new AssistantError('That took too long. Please try again.', 'timeout', 'retry')
    : new AssistantError('Stopped.', 'aborted', 'stopped');
}

/** Reads an SSE body (streamed or in one piece) into stage callbacks and the final event. */
export async function readEventStream(
  body: { getReader?: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } | null,
  text: () => Promise<string>,
  opts: SendOptions,
): Promise<AssistantReply> {
  let final: unknown = null;
  let serverError: Record<string, unknown> | null = null;
  const parser = createSseParser((data) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (ev.type === 'stage') {
      const s = parseStageEvent(ev);
      if (s) opts.onStage?.(s);
    } else if (ev.type === 'start') {
      opts.onStart?.({
        requestId: typeof ev.request_id === 'string' ? ev.request_id : null,
        conversationId: typeof ev.conversation_id === 'string' ? ev.conversation_id : null,
      });
    } else if (ev.type === 'final') final = ev;
    else if (ev.type === 'error') serverError = ev;
  });
  const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
  if (!reader) {
    opts.onStreamUnavailable?.();
    parser.push(await text());
  } else {
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  }
  parser.end();
  if (serverError) {
    const se = serverError as Record<string, unknown>;
    throw toError(typeof se.status === 'number' ? se.status : 500, se);
  }
  if (!final) throw new AssistantError('The connection dropped before the answer arrived. Please try again.', 'stream_incomplete', 'retry');
  return parseAssistantReply(final);
}

