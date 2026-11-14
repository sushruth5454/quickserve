import { sanitizeProps } from '../analyticsProps';
import { mapAssistantError, parseAssistantReply, parseSlot, parseStageEvent, parseTranscription } from '../assistant/parse';
import { composeDescription, draftToBookParams, readBookPrefill, selectedChips, slotParam, toggleChip } from '../assistant/prefill';
import { applyStage, progressSummary, stageLabel, uiLanguage, type ProgressRow } from '../assistant/progress';
import { createSseParser } from '../assistant/sse';
import { AssistantError, linkedAbort, readEventStream } from '../assistant/stream';
import { monthsBetween, starterPrompts } from '../assistant/suggestions';
import type { DraftCard } from '../assistant/types';
import { nextDays } from '../schedule';
import type { Booking } from '../types';

const draft = (over: Partial<DraftCard> = {}): DraftCard => ({
  type: 'draft',
  category_slug: 'ac-repair',
  category_name: 'AC Repair',
  provider: { provider_id: 'p1', provider_service_id: 'ps1', name: 'Ravi Kumar', visit_fee: 19900, rating_avg: 4.8, rating_count: 12 },
  brief: {
    issue_summary: 'Split AC not cooling; rattling noise from indoor unit',
    customer_reported: 'AC not cooling, making noise',
    customer_reported_en: null,
    details: ['Started yesterday'],
    likely_cause: null,
    likely_cause_confidence: null,
  },
  description: 'Issue: Split AC not cooling; rattling noise from indoor unit\nCustomer reported: "AC not cooling, making noise"\nDetails:\n- Started yesterday',
  description_en: 'Issue: Split AC not cooling; rattling noise from indoor unit\nCustomer reported: "AC not cooling, making noise"\nDetails:\n- Started yesterday',
  description_original: 'AC not cooling, making noise',
  problem_chips: ['Not cooling', 'Making noise'],
  slot: { type: 'window', date: '2026-11-15', start_hour: 18, starts_at: '2026-11-15T12:30:00.000Z', label: 'Sun, 15 Nov · 6–8 pm' },
  address: { address_id: 'addr-home', label: 'Home', area: 'Benz Circle', city: 'Vijayawada', needs_full_address: false },
  ...over,
});

describe('parseAssistantReply', () => {
  it('keeps valid cards, drops malformed ones and puts safety first', () => {
    const r = parseAssistantReply({
      conversation_id: 'c1',
      reply_text: 'Here you go',
      language: 'te',
      quick_replies: ['Change time', 42, 'Other pros', 'a', 'b'],
      cards: [
        draft(),
        { type: 'providers', category_slug: 'ac-repair', providers: [{ provider_id: 'p1' }] }, // no service id / fee
        { type: 'estimate', category_slug: 'ac-repair', category_name: 'AC Repair', visit_fee: { min: 9900, median: 19900, max: 24900, count: 5 }, typical_total: null, note: 'n' },
        { type: 'safety', title: 'Sparks', steps: ['Switch off the MCB'], emergency: [{ label: 'Emergency', number: '112' }, { label: 'Fake', number: 'call me' }] },
        { type: 'invented', foo: 1 },
      ],
    });
    expect(r.cards.map((c) => c.type)).toEqual(['safety', 'estimate', 'draft']);
    expect(r.language).toBe('te');
    expect(r.quick_replies).toEqual(['Change time', 'Other pros', 'a', 'b']);
    const safety = r.cards[0];
    expect(safety?.type === 'safety' && safety.emergency).toEqual([{ label: 'Emergency', number: '112' }]);
  });

  it('degrades to a plain message for garbage input', () => {
    const r = parseAssistantReply('oops');
    expect(r.cards).toEqual([]);
    expect(r.reply_text).toMatch(/something went wrong/i);
    expect(r.language).toBe('en');
  });

  it('rejects a draft whose slot is not a Book screen window', () => {
    const bad = { ...draft(), slot: { type: 'window', date: '2026-11-15', start_hour: 19, label: 'x' } };
    expect(parseAssistantReply({ reply_text: 'x', cards: [bad] }).cards).toEqual([]);
    expect(parseSlot({ type: 'asap' })).toEqual({ type: 'asap', label: 'As soon as possible' });
    expect(parseSlot({ type: 'window', date: '15-11-2026', start_hour: 18 })).toBeNull();
  });
});

describe('draft → Book screen prefill', () => {
  it('maps chips, description, slot and address to route params', () => {
    const p = draftToBookParams(draft());
    expect(p).toEqual({
      providerServiceId: 'ps1',
      from: 'assistant',
      description:
        'Not cooling, Making noise\nIssue: Split AC not cooling; rattling noise from indoor unit\nCustomer reported: "AC not cooling, making noise"\nDetails:\n- Started yesterday',
      slot: '2026-11-15@18',
      addressId: 'addr-home',
    });
    expect(slotParam({ type: 'asap', label: 'ASAP' })).toBe('asap');
    expect(draftToBookParams(draft({ address: { address_id: null, label: null, area: 'Patamata', city: 'Vijayawada', needs_full_address: true } })).addressId).toBeUndefined();
  });

  it('uses the server job brief (never the last chat message) and caps the length', () => {
    expect(composeDescription({ problem_chips: [], description: 'Issue: Tap leaking' })).toBe('Issue: Tap leaking');
    const long = composeDescription({ problem_chips: ['Tap leaking'], description: `Issue: Kitchen tap leaking\nCustomer reported: "${'नल '.repeat(400)}"` });
    expect(long.length).toBeLessThanOrEqual(800);
    expect(long.startsWith('Tap leaking\nIssue: Kitchen tap leaking')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
  });

  it('chip toggles only touch the first line, so the job brief is never rewritten', () => {
    const d = composeDescription(draft());
    expect(selectedChips(d)).toEqual(new Set(['not cooling', 'making noise']));
    const off = toggleChip(d, 'Making noise');
    expect(off.split('\n')[0]).toBe('Not cooling');
    expect(off.split('\n').slice(1)).toEqual(d.split('\n').slice(1));
    const bare = composeDescription({ problem_chips: [], description: 'Issue: AC not cooling\nCustomer reported: "AC not cooling"' });
    expect(selectedChips(bare).size).toBe(0);
    expect(toggleChip(bare, 'Not cooling')).toBe('Not cooling\nIssue: AC not cooling\nCustomer reported: "AC not cooling"');
    expect(toggleChip(toggleChip(bare, 'Not cooling'), 'Not cooling')).toBe(bare);
    // A plain one-line customer description keeps the old comma behaviour.
    expect(toggleChip('Tap leaking', 'Blocked drain')).toBe('Tap leaking, Blocked drain');
  });

  it('reads params back into the Book screen state (day + window)', () => {
    const now = new Date(2026, 10, 14, 9, 30); // Sat 14 Nov, 09:30 local
    const days = nextDays(now, 7);
    const p = readBookPrefill({ from: 'assistant', description: 'Not cooling, Noise', slot: '2026-11-15@18', addressId: 'a1' }, days, now);
    expect(p).toEqual({ fromAssistant: true, description: 'Not cooling, Noise', mode: 'schedule', dayIndex: 1, hour: 18, addressId: 'a1' });
  });

  it('keeps the day but drops a window that is no longer bookable; ignores bad slots', () => {
    const now = new Date(2026, 10, 14, 17, 30); // 17:30: today's 6–8 pm starts in 30 min (< 60 min lead)
    const days = nextDays(now, 7);
    expect(readBookPrefill({ slot: '2026-11-14@18' }, days, now)).toMatchObject({ mode: 'schedule', dayIndex: 0, hour: null });
    expect(readBookPrefill({ slot: 'asap' }, days, now)).toMatchObject({ mode: 'asap', dayIndex: null });
    expect(readBookPrefill({ slot: '2026-12-30@10' }, days, now)).toMatchObject({ mode: null, dayIndex: null });
    expect(readBookPrefill({ slot: '2026-11-15@19' }, days, now)).toMatchObject({ mode: 'schedule', dayIndex: 1, hour: null });
    expect(readBookPrefill({}, days, now)).toEqual({ fromAssistant: false, description: null, mode: null, dayIndex: null, hour: null, addressId: null });
  });
});

describe('starterPrompts', () => {
  const booking = (over: Partial<Booking>): Booking =>
    ({
      id: 'b',
      customer_id: 'me',
      provider_id: 'p1',
      category_id: 'c',
      provider_service_id: 'ps',
      status: 'closed',
      created_at: '2026-04-02T10:00:00Z',
      completed_at: '2026-04-02T12:00:00Z',
      categories: { name: 'AC Repair', slug: 'ac-repair' },
      providers: { rating_avg: 4.8, rating_count: 10, profiles: { full_name: 'Ravi Kumar' } },
      ...over,
    }) as Booking;

  it('suggests a due service and rebooking a past pro, then fills with defaults', () => {
    const now = new Date(2026, 10, 14);
    const list = starterPrompts([booking({})], now);
    expect(list[0]?.label).toBe('Your AC was serviced 7 months ago. Book a service?');
    expect(list[1]?.label).toBe('Book Ravi again (AC Repair)');
    expect(list).toHaveLength(4);
  });

  it('has only defaults without history and counts whole months', () => {
    expect(starterPrompts([], new Date()).every((p) => p.icon !== 'refresh')).toBe(true);
    expect(monthsBetween('2026-04-20T00:00:00Z', new Date(2026, 10, 14))).toBe(6);
  });
});

describe('production-shaped failures', () => {
  it('maps every server/network failure to a user action', () => {
    expect(mapAssistantError(null, null)).toMatchObject({ kind: 'offline', code: 'network' });
    expect(mapAssistantError(429, { code: 'rate_limited', error: 'You have used today\'s 30 AI messages.', request_id: 'r1' })).toEqual({
      kind: 'limited',
      code: 'rate_limited',
      message: "You have used today's 30 AI messages.",
      requestId: 'r1',
    });
    expect(mapAssistantError(429, { code: 'slow_down' }).kind).toBe('limited');
    expect(mapAssistantError(503, { code: 'ai_disabled' }).kind).toBe('disabled');
    expect(mapAssistantError(503, { code: 'ai_unavailable', error: 'busy' })).toMatchObject({ kind: 'retry', message: 'busy' });
    expect(mapAssistantError(504, null)).toMatchObject({ kind: 'retry', code: 'ai_unavailable' });
    expect(mapAssistantError(401, null).kind).toBe('auth');
    expect(mapAssistantError(400, { code: 'audio_too_long' }).kind).toBe('input');
    expect(mapAssistantError(502, '<html>bad gateway</html>').kind).toBe('retry');
  });

  it('defaults diagnosis confidence to low and drops cards with invented ids or fees', () => {
    const r = parseAssistantReply({
      reply_text: 'x',
      cards: [
        { type: 'diagnosis', title: 'AC', likely_issues: ['Filter'], pro_checks: [], confidence: 'certain' },
        { type: 'providers', category_slug: 'ac-repair', providers: [{ provider_id: 'p', provider_service_id: 'ps', visit_fee: 'cheap' }] },
        { type: 'estimate', category_slug: 'ac-repair', visit_fee: { min: -5, median: 1, max: 2, count: 1 }, typical_total: null },
      ],
    });
    expect(r.cards[0]).toMatchObject({ type: 'diagnosis', confidence: 'low' });
    expect(r.cards.find((c) => c.type === 'providers')).toBeUndefined();
    expect(r.cards.find((c) => c.type === 'estimate')).toMatchObject({ visit_fee: null });
  });
});
describe('v2 reply contract: voice turn, handoff, feedback id, draft brief', () => {
  it('parses user_turn transcripts, handoff, message id and stage summary; v1 transcript still works', () => {
    const r = parseAssistantReply({
      reply_text: 'ok',
      message_id: 203,
      request_id: 'req-1',
      handoff: { reason: 'low_confidence' },
      user_turn: { voice: true, transcript_original: 'मेरा नल लीक हो रहा है', transcript_en: 'My tap is leaking', photo: false },
      stages: [{ key: 'understanding', ms: 1900, ok: true }, { key: 'pros', ms: 270 }, { bad: 1 }],
      fallback_used: true,
      usage: { ms: 4210 },
      cards: [draft()],
    });
    expect(r.message_id).toBe(203);
    expect(r.handoff).toEqual({ reason: 'low_confidence' });
    expect(r.user_turn).toEqual({ voice: true, transcript_original: 'मेरा नल लीक हो रहा है', transcript_en: 'My tap is leaking', photo: false });
    expect(r.stages).toEqual([{ key: 'understanding', ms: 1900, ok: true }, { key: 'pros', ms: 270, ok: true }]);
    expect([r.fallback_used, r.elapsed_ms]).toEqual([true, 4210]);
    const d = r.cards.find((c) => c.type === 'draft');
    expect(d?.type === 'draft' && d.brief?.issue_summary).toBe('Split AC not cooling; rattling noise from indoor unit');
    expect(parseAssistantReply({ reply_text: 'x', handoff: { reason: 'call_me_now' } }).handoff).toBeNull();
    expect(parseAssistantReply({ reply_text: 'x', transcript: 'tap leaking' }).user_turn).toEqual({ voice: true, transcript_original: 'tap leaking', transcript_en: null, photo: false });
  });

  it('accepts v1 drafts without a brief and rejects a brief with no issue', () => {
    const { brief: _b, description: _d, ...v1 } = draft();
    const r = parseAssistantReply({ reply_text: 'x', cards: [v1] });
    const d = r.cards[0];
    expect(d?.type === 'draft' && [d.brief, d.description]).toEqual([null, draft().description_en]);
    const noIssue = parseAssistantReply({ reply_text: 'x', cards: [{ ...draft(), brief: { customer_reported: 'yes' } }] }).cards[0];
    expect(noIssue?.type === 'draft' && noIssue.brief).toBeNull();
  });

  it('validates transcriptions: empty is always unclear; no duplicate English line', () => {
    expect(parseTranscription({ transcript_original: 'నల్లా లీక్', transcript_en: 'Tap leak', language: 'te', clarity: 'clear', limits: { voice_left: 7 } })).toEqual({
      request_id: null,
      transcript_original: 'నల్లా లీక్',
      transcript_en: 'Tap leak',
      language: 'te',
      clarity: 'clear',
      voice_left: 7,
    });
    expect(parseTranscription({ transcript_original: '', clarity: 'clear' }).clarity).toBe('unclear');
    expect(parseTranscription({ transcript_original: 'AC not cooling', transcript_en: 'ac not cooling', clarity: 'weird' })).toMatchObject({ transcript_en: null, clarity: 'partial' });
    expect(parseTranscription(null).clarity).toBe('unclear');
  });

  it('maps new error codes', () => {
    expect(mapAssistantError(429, { code: 'photo_limited' }).kind).toBe('limited');
    expect(mapAssistantError(400, { code: 'bad_image' }).kind).toBe('input');
    expect(mapAssistantError(403, { code: 'photos_disabled' }).kind).toBe('disabled');
    expect(mapAssistantError(499, { code: 'aborted' }).kind).toBe('stopped');
  });
});

describe('server-sent events', () => {
  it('parses events split across chunks, CRLF line endings and comment pings', () => {
    const got: string[] = [];
    const p = createSseParser((d) => got.push(d));
    p.push('data: {"a":1}\n');
    p.push('\n: ping\n\nda');
    p.push('ta: {"b":2}\r');
    p.push('\n\r\ndata: {"c":3}');
    p.end();
    expect(got).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

const encoder = new TextEncoder();
const fakeBody = (chunks: string[]) => ({
  getReader: () => {
    let i = 0;
    return { read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]!) } : { done: true }) };
  },
});
const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe('progress stages are truthful and ordered', () => {
  it('only shows stages the server reported, in arrival order, updating status in place', () => {
    const events = [
      { type: 'stage', key: 'understanding', label: 'Understanding your request', status: 'active', t: 10 },
      { type: 'stage', key: 'understanding', status: 'failed', t: 4000, ms: 3990 },
      { type: 'stage', key: 'backup', status: 'active', t: 4000 },
      { type: 'stage', key: 'backup', status: 'done', t: 5800, ms: 1800 },
      { type: 'stage', key: 'pros', status: 'active', t: 5800 },
      { type: 'stage', key: 'pros', status: 'done', t: 6000, ms: 200 },
      { type: 'stage', key: 'bogus', status: 'exploded', t: 6000 },
      { nonsense: true },
    ];
    let rows: ProgressRow[] = [];
    for (const e of events) {
      const s = parseStageEvent(e);
      if (s) rows = applyStage(rows, s);
    }
    expect(rows.map((r) => `${r.key}:${r.status}`)).toEqual(['understanding:failed', 'backup:done', 'pros:done']);
    expect(progressSummary(3240, rows, 'en')).toBe('Done in 3.2s · 2 steps');
    expect(progressSummary(1000, [{ status: 'done' }], 'en')).toBe('Done in 1.0s · 1 step');
    expect(progressSummary(3240, rows, 'hi')).toBe('3.2 सेकंड में पूरा · 2 चरण');
  });

  it('localizes labels by stage key with the server label as fallback', () => {
    expect(stageLabel('pros', 'te')).toBe('మీ దగ్గరలోని టాప్-రేటెడ్ ప్రోలను వెతుకుతున్నాం');
    expect(stageLabel('pricing', 'hi')).toBe('हाल के कामों से कीमत का अंदाज़ा');
    expect(stageLabel('new_stage', 'hi', 'Checking warranty')).toBe('Checking warranty');
    expect(uiLanguage(null, 'మా ఇంట్లో')).toBe('te');
    expect(uiLanguage('hinglish')).toBe('en');
  });

  it('reads a streamed body: stages in order, then the final reply', async () => {
    const seen: string[] = [];
    let started: string | null = null;
    const reply = await readEventStream(
      fakeBody([
        sse({ type: 'start', request_id: 'r1', conversation_id: 'c1' }),
        sse({ type: 'stage', key: 'understanding', label: 'x', status: 'active', t: 1 }).slice(0, 20),
        sse({ type: 'stage', key: 'understanding', label: 'x', status: 'active', t: 1 }).slice(20) + ': ping\n\n',
        sse({ type: 'stage', key: 'understanding', status: 'done', t: 900, ms: 899 }),
        sse({ type: 'final', reply_text: 'Draft ready', cards: [draft()], message_id: 9 }),
      ]),
      async () => '',
      { onStage: (e) => seen.push(`${e.key}:${e.status}`), onStart: (i) => (started = i.conversationId) },
    );
    expect(seen).toEqual(['understanding:active', 'understanding:done']);
    expect(started).toBe('c1');
    expect(reply.reply_text).toBe('Draft ready');
    expect(reply.message_id).toBe(9);
  });

  it('falls back to reading the whole body when it cannot stream (generic state, same reply)', async () => {
    let generic = false;
    const reply = await readEventStream(null, async () => sse({ type: 'stage', key: 'pros', status: 'active', t: 1 }) + sse({ type: 'final', reply_text: 'ok' }), {
      onStreamUnavailable: () => (generic = true),
    });
    expect(generic).toBe(true);
    expect(reply.reply_text).toBe('ok');
  });

  it('turns a server error event or a dropped stream into a retryable error', async () => {
    await expect(readEventStream(fakeBody([sse({ type: 'error', status: 503, code: 'ai_unavailable', error: 'busy', request_id: 'r9' })]), async () => '', {})).rejects.toMatchObject({
      kind: 'retry',
      code: 'ai_unavailable',
      message: 'busy',
      requestId: 'r9',
    });
    await expect(readEventStream(fakeBody([sse({ type: 'stage', key: 'pros', status: 'active', t: 1 })]), async () => '', {})).rejects.toMatchObject({ code: 'stream_incomplete', kind: 'retry' });
  });
});

describe('Stop / timeout', () => {
  it('a Stop aborts the request signal and is not reported as a timeout', () => {
    const stop = new AbortController();
    const a = linkedAbort(stop.signal, 60_000);
    expect(a.signal.aborted).toBe(false);
    stop.abort();
    expect(a.signal.aborted).toBe(true);
    expect(a.timedOut()).toBe(false);
    a.done();
  });

  it('the client timeout aborts and is reported as a timeout', () => {
    jest.useFakeTimers();
    try {
      const a = linkedAbort(undefined, 1000);
      jest.advanceTimersByTime(1001);
      expect([a.signal.aborted, a.timedOut()]).toEqual([true, true]);
      a.done();
    } finally {
      jest.useRealTimers();
    }
  });

  it('an already-stopped caller signal aborts immediately', () => {
    const stop = new AbortController();
    stop.abort();
    const a = linkedAbort(stop.signal, 60_000);
    expect(a.signal.aborted).toBe(true);
    a.done();
    expect(new AssistantError('Stopped.', 'aborted', 'stopped').kind).toBe('stopped');
  });
});

describe('analytics props never carry free text', () => {
  it('keeps numbers, booleans, short ids and numeric maps only', () => {
    expect(
      sanitizeProps({
        category: 'ac-repair',
        total_ms: 3241.5678,
        streamed: true,
        stages: { understanding: 1900.4, pros: 270, note: 'x' as unknown as number },
        message: 'my phone is 9848012345 and I live at flat 4',
        name: 'Ravi Kumar',
        BadKey: 1,
        nothing: null,
      }),
    ).toEqual({ category: 'ac-repair', total_ms: 3241.568, streamed: true, stages: { understanding: 1900, pros: 270 } });
  });
});