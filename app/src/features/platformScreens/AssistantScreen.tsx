import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { DiagnosisCardView, DraftCardView, EstimateCardView, ProvidersCardView, SafetyCardView } from '../../components/assistant/AssistantCards';
import { AssistantBubble, FeedbackBar, HandoffCard, QuickReplies, StarterList, UserBubble, type FeedbackValue } from '../../components/assistant/ChatBits';
import { Composer } from '../../components/assistant/Composer';
import { ProgressSteps } from '../../components/assistant/ProgressSteps';
import { VoicePreview } from '../../components/assistant/VoicePreview';
import { Button, EmptyState, Header, IconButton, InlineAlert, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { track } from '../../lib/analytics';
import { getMyProfile, getProviderService, listMyBookings } from '../../lib/api';
import { AssistantError, sendToAssistant, transcribeVoice } from '../../lib/assistant/client';
import {
  commitIfCurrent,
  conversationLoadResult,
  conversationLoadState,
  createConversationGeneration,
  idleConversationLoad,
  runIfAiEnabled,
  shouldAutoSend,
  type ConversationLoadState,
} from '../../lib/assistant/conversationState';
import { listConversations, loadConversation, photoUrl, setFeedback, type FeedbackReason, type StoredTurn } from '../../lib/assistant/history';
import { friendlyError } from '../../lib/errors';
import { visualPiiRedactionReady } from '../../features/ai/imagePrivacy';
import type { AssistantErrorKind } from '../../lib/assistant/parse';
import { isServiceBookingEnabled, resolveServiceBookingEntry } from '../../lib/assistant/prefill';
import { applyStage, uiLanguage, type ProgressRow } from '../../lib/assistant/progress';
import { speak, stopSpeaking } from '../../lib/assistant/speech';
import { starterPrompts, type StarterPrompt } from '../../lib/assistant/suggestions';
import type { AssistantCard, AssistantLanguage, DraftCard, HandoffReason, ProviderPick, Transcription, VoiceMeta } from '../../lib/assistant/types';
import { aiAssistantEnabled, isDemoMode } from '../../lib/config';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useSelectedLocation } from '../../lib/locationContext';
import { locationTitle } from '../../lib/locationModel';
import { useT } from '../../i18n';
import { useTheme } from '../../theme';

type Msg =
  | {
      id: string;
      role: 'user';
      text: string;
      voice?: boolean;
      translated?: string | null;
      photoUri?: string | null;
      photoPath?: string | null;
      pending?: boolean;
      stopped?: boolean;
    }
  | {
      id: string;
      role: 'assistant';
      text: string;
      cards: AssistantCard[];
      quickReplies: string[];
      messageId: number | null;
      requestId: string | null;
      language: AssistantLanguage | null;
      handoff: HandoffReason | null;
      feedback: FeedbackValue;
      progress: ProgressRow[];
      elapsedMs: number | null;
    }
  | { id: string; role: 'error'; text: string; retry: Retry | VoiceRetry | null; kind: AssistantErrorKind; requestId: string | null; aiBusy?: boolean };

type Retry = { message?: string; voice?: VoiceMeta; image?: { data: string; mimeType: string }; photoUri?: string | null };
type VoiceRetry = { audio: { data: string; mimeType: string; durationMs: number } };
type VoiceState = { phase: 'transcribing' } | { phase: 'review'; t: Transcription };

/** Photos above ~3 MB are rejected by the server; check before uploading (base64 is 4/3 of the bytes). */
const MAX_PHOTO_B64 = 4_000_000;
/** Reopening the assistant within this window continues the last conversation. */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
const CHANGE_ADDRESS = 'Change address';

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${seq++}`;

function turnsToMessages(turns: StoredTurn[]): Msg[] {
  return turns.map((t): Msg =>
    t.role === 'user'
      ? { id: `s${t.id}`, role: 'user', text: t.text === '(photo)' ? '' : t.text, voice: !!t.voice, translated: t.voice?.transcript_en ?? null, photoPath: t.photoPath ?? null }
      : {
          id: `s${t.id}`,
          role: 'assistant',
          text: t.text,
          cards: t.cards ?? [],
          quickReplies: t.quickReplies ?? [],
          messageId: t.id,
          requestId: null,
          language: t.language ?? null,
          handoff: t.handoff ?? null,
          feedback: t.feedback ?? null,
          progress: [],
          elapsedMs: null,
        },
  );
}

export default function AssistantScreen() {
  const t = useTheme();
  const translate = useT();
  const flags = useAppFeatureFlags();
  const aiOn = aiAssistantEnabled && flags.isOn('ai_assistant');
  const aiCapabilityRef = useRef(aiOn);
  aiCapabilityRef.current = aiOn;
  const toast = useToast();
  const reduced = useReducedMotion();
  const { location } = useSelectedLocation();
  const params = useLocalSearchParams<{ q?: string; category?: string; name?: string; conversation?: string }>();
  const conversationGeneration = useMemo(() => createConversationGeneration(), []);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ConversationLoadState>(idleConversationLoad);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [generic, setGeneric] = useState(false);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [photo, setPhoto] = useState<{ data: string; mimeType: string; uri: string } | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [permIssue, setPermIssue] = useState<'mic' | 'camera' | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [starters, setStarters] = useState<StarterPrompt[]>(() => starterPrompts([], new Date()));
  const [firstName, setFirstName] = useState('');
  const canStartAiWork = aiOn && (selectedConversation.status === 'ready' || (selectedConversation.status === 'idle' && !params.conversation));
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const autoSent = useRef(false);
  const skipAutoResume = useRef(false);
  const chatAbort = useRef<AbortController | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);

  const lastAssistant = [...messages].reverse().find((m): m is Extract<Msg, { role: 'assistant' }> => m.role === 'assistant');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lang = uiLanguage(lastAssistant?.language, lastUser?.text ?? '');

  useEffect(() => {
    track('assistant_opened', { source: params.q ? 'search' : params.category ? 'category' : params.conversation ? 'history' : 'home' });
    void Promise.all([listMyBookings().catch(() => []), getMyProfile().catch(() => null)]).then(([bookings, profile]) => {
      const list = starterPrompts(bookings, new Date());
      // Opened from a category's results: lead with that service.
      if (params.category && params.name) {
        list.unshift({ label: `Help me choose a ${params.name} pro`, message: `I need a ${params.name}. Help me pick the right pro.`, icon: 'chatbubble-ellipses-outline' });
      }
      setStarters(list.slice(0, 4));
      setFirstName(profile?.full_name?.split(' ')[0] ?? '');
    });
    return () => {
      conversationGeneration.invalidate();
      stopSpeaking();
    };
  }, [conversationGeneration]);

  const openConversation = useCallback(
    async (id: string, auto: boolean) => {
      const key = conversationGeneration.begin();
      chatAbort.current = null;
      voiceAbort.current = null;
      setBusy(false);
      setProgress([]);
      setGeneric(false);
      setVoice(null);
      setPhoto(null);
      setAttachMenu(false);
      stopSpeaking();
      setMessages([]);
      setConversationId(id);
      setResumed(false);
      setSelectedConversation(conversationLoadState(id, 'loading', auto));

      if (isDemoMode) {
        commitIfCurrent(conversationGeneration, key, () => setSelectedConversation(conversationLoadState(id, 'unavailable', auto)));
        return;
      }

      try {
        const turns = await loadConversation(id);
        const committed = commitIfCurrent(conversationGeneration, key, () => {
          setSelectedConversation(conversationLoadResult(id, turns.length, auto));
          setMessages(turnsToMessages(turns));
          setResumed(auto && turns.length > 0);
        });
        if (!committed || !turns.length) return;

        // Private photos: short-lived signed links, owner-only (RLS).
        for (const turn of turns) {
          if (turn.role === 'user' && turn.photoPath) {
            void photoUrl(turn.photoPath).then((uri) => {
              if (!uri) return;
              commitIfCurrent(conversationGeneration, key, () =>
                setMessages((m) => m.map((x) => (x.id === `s${turn.id}` && x.role === 'user' ? { ...x, photoUri: uri } : x))),
              );
            }).catch(() => undefined);
          }
        }
      } catch {
        commitIfCurrent(conversationGeneration, key, () => {
          setMessages([]);
          setResumed(false);
          setSelectedConversation(conversationLoadState(id, 'error', auto));
        });
      }
    },
    [conversationGeneration],
  );

  useEffect(() => {
    if (aiOn) return;
    conversationGeneration.invalidate();
    chatAbort.current = null;
    voiceAbort.current = null;
    setBusy(false);
    setProgress([]);
    setGeneric(false);
    setVoice(null);
    setPhoto(null);
    setAttachMenu(false);
  }, [aiOn, conversationGeneration]);

  // Resume: a conversation picked from history, else the last one if it is recent (unless opened with a new question).
  useEffect(() => {
    if (params.conversation) {
      skipAutoResume.current = false;
      void openConversation(params.conversation, false);
      return;
    }
    if (!aiOn || params.q || params.category || isDemoMode || skipAutoResume.current) return;
    const key = conversationGeneration.current();
    void listConversations()
      .then((list) => {
        if (!conversationGeneration.isCurrent(key)) return;
        const last = list[0];
        if (last && Date.now() - Date.parse(last.updatedAt) < RESUME_WINDOW_MS) void openConversation(last.id, true);
      })
      .catch(() => undefined);
    return () => {
      if (conversationGeneration.isCurrent(key)) conversationGeneration.invalidate();
    };
  }, [aiOn, conversationGeneration, openConversation, params.category, params.conversation, params.q]);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduced }), 80);

  const send = useCallback(
    async (input: Retry) => {
      if (!aiCapabilityRef.current || !canStartAiWork || busy) return;
      const key = conversationGeneration.current();
      const userId = nextId();
      const started = Date.now();
      stopSpeaking();
      setMessages((m) => [
        ...m.filter((x) => x.role !== 'error'),
        { id: userId, role: 'user', text: input.message ?? '', voice: !!input.voice, translated: input.voice?.transcript_en ?? null, photoUri: input.photoUri ?? null },
      ]);
      setBusy(true);
      setProgress([]);
      setGeneric(false);
      scrollToEnd();
      const ctrl = new AbortController();
      const release = conversationGeneration.track(ctrl);
      chatAbort.current = ctrl;
      let rows: ProgressRow[] = [];
      try {
        const request = runIfAiEnabled(aiCapabilityRef.current && canStartAiWork, () =>
          sendToAssistant(
            {
              conversationId,
              message: input.message,
              voice: input.voice,
              image: input.image,
              location: { area: location.area, city: location.city, lat: location.lat, lng: location.lng, address_id: location.addressId },
            },
            {
              signal: ctrl.signal,
              onStage: (e) => {
                if (!conversationGeneration.isCurrent(key) || !aiCapabilityRef.current || ctrl.signal.aborted) return;
                rows = applyStage(rows, e);
                setProgress(rows);
              },
              onStart: (info) => {
                const id = info.conversationId;
                if (id && aiCapabilityRef.current && !ctrl.signal.aborted) commitIfCurrent(conversationGeneration, key, () => setConversationId(id));
              },
              onStreamUnavailable: () => {
                if (aiCapabilityRef.current && !ctrl.signal.aborted) commitIfCurrent(conversationGeneration, key, () => setGeneric(true));
              },
            },
          ),
        );
        if (!request) return;
        const reply = await request;
        if (!conversationGeneration.isCurrent(key) || !aiCapabilityRef.current || ctrl.signal.aborted) return;
        const elapsedMs = reply.elapsed_ms ?? Date.now() - started;
        commitIfCurrent(conversationGeneration, key, () => {
          if (reply.conversation_id) setConversationId(reply.conversation_id);
          setMessages((m) => [
            ...m.map((x) =>
              x.id === userId && x.role === 'user'
                ? { ...x, text: reply.user_turn?.transcript_original ?? x.text, translated: reply.user_turn?.transcript_en ?? x.translated ?? null, pending: false }
                : x,
            ),
            {
              id: nextId(),
              role: 'assistant',
              text: reply.reply_text,
              cards: reply.cards,
              quickReplies: reply.quick_replies,
              messageId: reply.message_id,
              requestId: reply.request_id,
              language: reply.language,
              handoff: reply.handoff?.reason ?? null,
              feedback: null,
              progress: rows.map((r) => (r.status === 'active' ? { ...r, status: 'done' } : r)),
              elapsedMs,
            },
          ]);
        });
        const stageMs: Record<string, number> = {};
        for (const s of reply.stages) stageMs[s.key] = (stageMs[s.key] ?? 0) + s.ms;
        track('stage_latency', { total_ms: elapsedMs, steps: reply.stages.length, streamed: rows.length > 0, stages: stageMs });
        if (reply.fallback_used) track('fallback_model_used', { total_ms: elapsedMs });
        const draft = reply.cards.find((c): c is DraftCard => c.type === 'draft');
        if (draft) track('draft_created', { category: draft.category_slug, slot: draft.slot.type, from_voice: !!input.voice, with_photo: !!input.image });
        if (readAloud && reply.reply_text) speak(reply.reply_text, reply.language);
        if (reply.limits && reply.limits.messages_left <= 3) toast({ message: `${reply.limits.messages_left} AI messages left today`, tone: 'warning' });
      } catch (e) {
        if (!conversationGeneration.isCurrent(key) || !aiCapabilityRef.current) return;
        const err = e instanceof AssistantError ? e : new AssistantError('Something went wrong. Please try again.', 'internal', 'retry');
        if (err.kind === 'stopped') {
          track('assistant_stopped', { stage: rows.find((r) => r.status === 'active')?.key ?? null, after_ms: Date.now() - started });
          setMessages((m) => m.map((x) => (x.id === userId && x.role === 'user' ? { ...x, stopped: true } : x)));
        } else {
          const aiBusy = friendlyError(e).key === 'ai.busy' || err.kind === 'limited';
          const retryable = err.kind === 'retry' || err.kind === 'offline' || aiBusy;
          setMessages((m) => [
            ...m,
            {
              id: nextId(),
              role: 'error',
              text: aiBusy ? '' : err.message,
              retry: retryable ? input : null,
              kind: err.kind,
              requestId: err.requestId,
              aiBusy,
            },
          ]);
        }
      } finally {
        release();
        if (conversationGeneration.isCurrent(key) && chatAbort.current === ctrl) {
          chatAbort.current = null;
          setBusy(false);
          setProgress([]);
          scrollToEnd();
        }
      }
    },
    [busy, canStartAiWork, conversationGeneration, conversationId, location, readAloud, toast],
  );

  // Home search ("Ask QuickServe AI" with text) opens the chat with the question already sent.
  useEffect(() => {
    if (!shouldAutoSend(canStartAiWork, params.q, autoSent.current)) return;
    autoSent.current = true;
    void runIfAiEnabled(aiCapabilityRef.current, () => send({ message: params.q!.trim().slice(0, 1000) }));
  }, [canStartAiWork, params.q, send]);

  const stop = () => chatAbort.current?.abort();

  const onVoice = async (audio: { data: string; mimeType: string; durationMs: number }, expectedKey = conversationGeneration.current()) => {
    if (!aiCapabilityRef.current || !canStartAiWork || !conversationGeneration.isCurrent(expectedKey)) return;
    const key = expectedKey;
    track('voice_used', { duration_s: Math.round(audio.durationMs / 1000) });
    const ctrl = new AbortController();
    voiceAbort.current?.abort();
    const release = conversationGeneration.track(ctrl);
    voiceAbort.current = ctrl;
    const isCurrentVoice = () =>
      conversationGeneration.isCurrent(key) && voiceAbort.current === ctrl && aiCapabilityRef.current && canStartAiWork && !ctrl.signal.aborted;
    setVoice({ phase: 'transcribing' });
    try {
      const request = runIfAiEnabled(aiCapabilityRef.current && canStartAiWork, () =>
        transcribeVoice({ data: audio.data, mimeType: audio.mimeType }, ctrl.signal),
      );
      if (!request) return;
      const tr = await request;
      if (isCurrentVoice()) setVoice({ phase: 'review', t: tr });
    } catch (e) {
      if (!isCurrentVoice()) return;
      setVoice(null);
      const err = e instanceof AssistantError ? e : null;
      if (err?.kind !== 'stopped') {
        const aiBusy = friendlyError(e).key === 'ai.busy' || err?.kind === 'limited';
        if (aiBusy) {
          setMessages((m) => [
            ...m,
            {
              id: nextId(),
              role: 'error',
              text: '',
              retry: { audio },
              kind: err?.kind ?? 'retry',
              requestId: err?.requestId ?? null,
              aiBusy: true,
            },
          ]);
        } else {
          toast({ message: err?.message ?? 'Could not process the recording. Please type instead.', tone: 'error' });
        }
      }
    } finally {
      release();
      if (conversationGeneration.isCurrent(key) && voiceAbort.current === ctrl) voiceAbort.current = null;
    }
  };

  const sendVoice = (text: string, edited: boolean) => {
    if (voice?.phase !== 'review') return;
    const tr = voice.t;
    setVoice(null);
    void send({ message: text, voice: { transcript_original: text, transcript_en: edited ? null : tr.transcript_en, language: tr.language, edited } });
  };

  const retryFailedCall = (retry: Retry | VoiceRetry) => {
    if ('audio' in retry) {
      setMessages((m) => m.filter((x) => x.role !== 'error'));
      void onVoice(retry.audio);
    } else {
      void send(retry);
    }
  };

  const pickPhoto = async (source: 'camera' | 'library') => {
    setAttachMenu(false);
    if (!aiCapabilityRef.current || !canStartAiWork || !visualPiiRedactionReady) return;
    const key = conversationGeneration.current();
    const isCurrent = () => conversationGeneration.isCurrent(key) && aiCapabilityRef.current && canStartAiWork;
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!isCurrent()) return;
        if (!perm.granted) {
          setPermIssue('camera');
          return;
        }
      }
      // EXIF removal is not visual redaction; the server gate remains closed until visible text is scrubbed.
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, exif: false };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (!isCurrent()) return;
      const a = res.canceled ? null : res.assets[0];
      if (!a) return;
      const data = a.base64 ?? (a.uri.startsWith('data:') ? (a.uri.split(',')[1] ?? null) : null);
      if (!data) {
        toast({ message: 'Could not read that photo. Please try another.', tone: 'error' });
        return;
      }
      if (data.length > MAX_PHOTO_B64) {
        toast({ message: 'That photo is too large (max 3 MB). Please choose a smaller one.', tone: 'error' });
        return;
      }
      commitIfCurrent(conversationGeneration, key, () =>
        setPhoto({ data, mimeType: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', uri: a.uri }),
      );
      track('photo_attached', { source });
    } catch (e) {
      if (isCurrent()) toast({ message: (e as Error).message || 'Could not open photos.', tone: 'error' });
    }
  };

  const sendText = (text: string) => {
    if (photo && visualPiiRedactionReady) {
      const p = photo;
      setPhoto(null);
      void send({ message: text, image: { data: p.data, mimeType: p.mimeType }, photoUri: p.uri });
    } else {
      if (photo) setPhoto(null);
      void send({ message: text });
    }
  };

  const rate = (msgId: string, messageId: number | null, rating: 1 | -1, reason: FeedbackReason | null) => {
    setMessages((m) => m.map((x) => (x.id === msgId && x.role === 'assistant' ? { ...x, feedback: rating } : x)));
    track('assistant_feedback', { rating, reason });
    if (messageId != null) void setFeedback(messageId, rating, reason).catch(() => toast({ message: 'Could not save your feedback.', tone: 'error' }));
  };

  const openBookingEntry = async (providerServiceId: string, draft?: DraftCard) => {
    const key = conversationGeneration.current();
    try {
      const service = await getProviderService(providerServiceId);
      if (!conversationGeneration.isCurrent(key)) return;
      const entry = resolveServiceBookingEntry(service, draft ?? null);
      if (entry.kind === 'unavailable') {
        toast({ message: 'This service cannot be booked from this flow.', tone: 'warning' });
        return;
      }
      if (!isServiceBookingEnabled(entry, flags.archetypes)) {
        toast({ message: 'This booking type is not currently available.', tone: 'warning' });
        return;
      }
      router.push({ pathname: entry.pathname, params: entry.params } as Href);
    } catch (e) {
      if (conversationGeneration.isCurrent(key)) toast({ message: (e as Error).message || 'Could not load this service.', tone: 'error' });
    }
  };

  const reviewDraft = (d: DraftCard) => {
    void openBookingEntry(d.provider.provider_service_id, d);
  };

  const bookPro = (p: ProviderPick, draft: DraftCard | undefined) => {
    if (draft) {
      const handoff = {
        ...draft,
        provider: { ...draft.provider, provider_id: p.provider_id, provider_service_id: p.provider_service_id, name: p.name, visit_fee: p.visit_fee },
      };
      void openBookingEntry(p.provider_service_id, handoff);
    } else {
      void openBookingEntry(p.provider_service_id);
    }
  };

  const newChat = () => {
    conversationGeneration.invalidate();
    chatAbort.current = null;
    voiceAbort.current = null;
    autoSent.current = true;
    skipAutoResume.current = true;
    stopSpeaking();
    setMessages([]);
    setConversationId(null);
    setSelectedConversation(idleConversationLoad);
    setResumed(false);
    setBusy(false);
    setProgress([]);
    setGeneric(false);
    setVoice(null);
    setPhoto(null);
    setAttachMenu(false);
    setPermIssue(null);
    if (params.conversation || params.q || params.category || params.name) router.replace('/assistant');
  };

  const toggleReadAloud = () => {
    setReadAloud((on) => {
      if (on) stopSpeaking();
      else if (lastAssistant?.text) speak(lastAssistant.text, lastAssistant.language);
      return !on;
    });
  };

  const quickReplies = useMemo(() => {
    if (busy || voice || !lastAssistant || messages[messages.length - 1] !== lastAssistant) return [];
    const hasDraft = lastAssistant.cards.some((c) => c.type === 'draft');
    return hasDraft ? [...lastAssistant.quickReplies.slice(0, 3), CHANGE_ADDRESS] : lastAssistant.quickReplies;
  }, [busy, voice, lastAssistant, messages]);

  const screenGeneration = conversationGeneration.current();
  const sendTextForScreen = (text: string) => {
    if (conversationGeneration.isCurrent(screenGeneration)) sendText(text);
  };
  const sendForScreen = (input: Retry) => {
    if (conversationGeneration.isCurrent(screenGeneration)) void send(input);
  };
  const pickPhotoForScreen = (source: 'camera' | 'library') => {
    if (conversationGeneration.isCurrent(screenGeneration)) void pickPhoto(source);
  };
  const setAttachMenuForScreen = () => {
    if (conversationGeneration.isCurrent(screenGeneration)) setAttachMenu((open) => !open);
  };
  const removePhotoForScreen = () => {
    if (conversationGeneration.isCurrent(screenGeneration)) setPhoto(null);
  };
  const voiceForScreen = (audio: { data: string; mimeType: string; durationMs: number }) => {
    if (conversationGeneration.isCurrent(screenGeneration)) void onVoice(audio, screenGeneration);
  };
  const sendVoiceForScreen = (text: string, edited: boolean) => {
    if (conversationGeneration.isCurrent(screenGeneration)) sendVoice(text, edited);
  };
  const retryForScreen = (retry: Retry | VoiceRetry) => {
    if (conversationGeneration.isCurrent(screenGeneration)) retryFailedCall(retry);
  };
  const reviewDraftForScreen = (draft: DraftCard) => {
    if (conversationGeneration.isCurrent(screenGeneration)) reviewDraft(draft);
  };
  const bookProForScreen = (provider: ProviderPick, draft: DraftCard | undefined) => {
    if (conversationGeneration.isCurrent(screenGeneration)) bookPro(provider, draft);
  };
  const rateForScreen = (messageId: string, storedMessageId: number | null, rating: 1 | -1, reason: FeedbackReason | null) => {
    if (conversationGeneration.isCurrent(screenGeneration)) rate(messageId, storedMessageId, rating, reason);
  };

  const hasSelectedConversation = !!params.conversation || !!conversationId;
  if (!aiOn && !hasSelectedConversation) {
    return (
      <Screen
        header={
          <Header
            title="QuickServe AI"
            right={!isDemoMode ? <IconButton icon="time-outline" accessibilityLabel="Past conversations" onPress={() => router.push('/assistant-history')} /> : undefined}
          />
        }
      >
        <EmptyState icon="sparkles-outline" title="QuickServe AI is not available" message="You can still find a pro and book from the service list." actionLabel="Browse services" onAction={() => router.replace('/')} />
      </Screen>
    );
  }

  const attachButton =
    !canStartAiWork || voice || busy || !visualPiiRedactionReady ? null : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={photo ? 'Change attached photo' : 'Attach a photo of the problem'}
        onPress={() => (Platform.OS === 'web' ? pickPhotoForScreen('library') : setAttachMenuForScreen())}
        hitSlop={4}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent' })}
      >
        <Ionicons name="camera-outline" size={22} color={t.colors.textSecondary} />
      </Pressable>
    );

  return (
    <Screen
      header={
        <Header
          title="QuickServe AI"
          subtitle="Describe the problem. I'll find the right pro."
          right={
            <View style={{ flexDirection: 'row' }}>
              {Platform.OS !== 'web' ? (
                <IconButton
                  icon={readAloud ? 'volume-high' : 'volume-mute-outline'}
                  accessibilityLabel={readAloud ? 'Read replies aloud: on' : 'Read replies aloud: off'}
                  accessibilityHint="Speaks each answer in your language"
                  onPress={toggleReadAloud}
                />
              ) : null}
              {!isDemoMode ? <IconButton icon="time-outline" accessibilityLabel="Past conversations" onPress={() => router.push('/assistant-history')} /> : null}
              {messages.length || conversationId || params.conversation ? <IconButton icon="create-outline" accessibilityLabel="New chat" onPress={newChat} /> : null}
            </View>
          }
        />
      }
      scrollRef={scrollRef}
      gap={t.spacing.lg}
      scrollProps={{ onContentSizeChange: () => scrollRef.current?.scrollToEnd({ animated: false }) }}
      footer={
        <View style={{ gap: t.spacing.sm }}>
          {!aiOn ? (
            <InlineAlert message="QuickServe AI is unavailable. You can review this conversation, but new AI requests are disabled." tone="warning" />
          ) : !canStartAiWork ? (
            <InlineAlert message="This conversation is read-only until it loads. Retry loading it or start a new chat to send a request." tone="warning" />
          ) : (
            <>
          {!visualPiiRedactionReady ? (
            <Text variant="caption" color="muted" align="center">
              Photo input is temporarily unavailable until visible phone numbers and addresses can be safely redacted.
            </Text>
          ) : null}
          {permIssue === 'mic' || (permIssue === 'camera' && visualPiiRedactionReady) ? (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md, borderRadius: 14, backgroundColor: t.colors.warningSoft }}
              accessibilityLiveRegion="polite"
            >
              <Ionicons name={permIssue === 'mic' ? 'mic-off-outline' : 'camera-outline'} size={18} color={t.colors.warningText} />
              <Text variant="caption" color="warningText" style={{ flex: 1 }}>
                {permIssue === 'mic' ? 'Microphone access is off. Allow it in Settings to talk to QuickServe AI, or type instead.' : 'Camera access is off. Allow it in Settings, or choose a photo from your gallery.'}
              </Text>
              <Button title="Open Settings" size="sm" variant="outline" onPress={() => void Linking.openSettings()} />
              <IconButton icon="close" accessibilityLabel="Dismiss" onPress={() => setPermIssue(null)} />
            </View>
          ) : null}
          <QuickReplies items={quickReplies} onPick={(q) => (q === CHANGE_ADDRESS ? router.push('/location') : sendForScreen({ message: q }))} disabled={busy} />
          {attachMenu && visualPiiRedactionReady ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button title="Take photo" size="sm" variant="outline" leftIcon="camera-outline" onPress={() => pickPhotoForScreen('camera')} />
              <Button title="Choose from gallery" size="sm" variant="outline" leftIcon="images-outline" onPress={() => pickPhotoForScreen('library')} />
            </View>
          ) : null}
          {photo && visualPiiRedactionReady ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Image source={{ uri: photo.uri }} style={{ width: 52, height: 52, borderRadius: 10 }} contentFit="cover" accessibilityLabel="Attached photo" />
              <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
                Photo attached. Add a few words (optional) and send.
              </Text>
              <IconButton icon="close-circle" accessibilityLabel="Remove photo" onPress={removePhotoForScreen} />
            </View>
          ) : null}
          {voice ? (
            <VoicePreview
              key={screenGeneration}
              transcription={voice.phase === 'review' ? voice.t : null}
              lang={lang}
              onSend={sendVoiceForScreen}
              onDiscard={() => {
                if (!conversationGeneration.isCurrent(screenGeneration)) return;
                voiceAbort.current?.abort();
                setVoice(null);
              }}
              onRetry={() => {
                if (conversationGeneration.isCurrent(screenGeneration)) setVoice(null);
              }}
            />
          ) : (
            <Composer
              key={screenGeneration}
              busy={busy}
              onSend={sendTextForScreen}
              onVoice={voiceForScreen}
              onVoiceError={(message) => {
                if (conversationGeneration.isCurrent(screenGeneration)) toast({ message, tone: 'error' });
              }}
              onMicDenied={() => {
                if (conversationGeneration.isCurrent(screenGeneration)) setPermIssue('mic');
              }}
              onStop={() => {
                if (conversationGeneration.isCurrent(screenGeneration)) stop();
              }}
              attach={attachButton}
              canSendEmpty={!!photo && visualPiiRedactionReady}
            />
          )}
          <Text variant="micro" color="muted" align="center">
            AI can make mistakes. You always review and pay in checkout.
          </Text>
            </>
          )}
        </View>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Service location: ${locationTitle(location)}. Tap to change.`}
        onPress={() => router.push('/location')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.sm,
          alignSelf: 'center',
          paddingHorizontal: t.spacing.md,
          minHeight: 36,
          borderRadius: t.radii.pill,
          backgroundColor: t.colors.surfaceAlt,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="location-outline" size={14} color={t.colors.textSecondary} />
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          Pros near {locationTitle(location)}
        </Text>
        <Text variant="captionStrong" color="primaryText">
          Change
        </Text>
      </Pressable>
      <AssistantBubble
        text={`Hi${firstName ? ` ${firstName}` : ''}! Tell me what's wrong, in English, हिंदी or తెలుగు. I'll suggest the right pro, show typical prices and prepare the booking for you to review.`}
      />
      {selectedConversation.status === 'loading' ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="caption" color="muted">
            Loading conversation…
          </Text>
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : null}
      {selectedConversation.status === 'error' ? (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message="Could not load this conversation. Check your connection and retry." tone="danger" />
          <Button title={translate('location.retry')} variant="outline" onPress={() => void openConversation(selectedConversation.id, selectedConversation.automatic)} />
        </View>
      ) : null}
      {selectedConversation.status === 'empty' ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No messages available"
          message="This conversation may be empty or no longer available."
          actionLabel={translate('location.retry')}
          onAction={() => void openConversation(selectedConversation.id, selectedConversation.automatic)}
        />
      ) : null}
      {selectedConversation.status === 'unavailable' ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="Past conversation unavailable"
          message="Past conversations cannot be opened in demo mode."
          actionLabel={translate('location.retry')}
          onAction={() => void openConversation(selectedConversation.id, selectedConversation.automatic)}
        />
      ) : null}
      {resumed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm }}>
          <Text variant="caption" color="muted">
            Continuing your last chat
          </Text>
          <Button title="New chat" size="sm" variant="ghost" onPress={newChat} />
        </View>
      ) : null}
      {messages.length === 0 && !params.q && !params.conversation && selectedConversation.status === 'idle' ? (
        <StarterList items={starters} onPick={(p) => sendForScreen({ message: p.message })} />
      ) : null}

      {messages.map((m) => (
        <Animated.View key={m.id} entering={reduced ? undefined : FadeInDown.duration(220)} style={{ gap: t.spacing.md }}>
          {m.role === 'user' ? (
            <View style={{ gap: 2 }}>
              <UserBubble text={m.text} voice={m.voice} pending={m.pending} translated={m.translated} photoUri={m.photoUri} />
              {m.stopped ? (
                <Text variant="micro" color="muted" align="right">
                  Stopped
                </Text>
              ) : null}
            </View>
          ) : m.role === 'error' ? (
            m.aiBusy ? (
              <View style={{ gap: t.spacing.sm }}>
                <InlineAlert message={translate('ai.busy')} tone="warning" />
                {m.retry ? <Button title={translate('location.retry')} variant="outline" onPress={() => retryForScreen(m.retry!)} /> : null}
              </View>
            ) : (
              <AssistantBubble
                text={m.requestId ? `${m.text} (Ref ${m.requestId.slice(0, 8)})` : m.text}
                error
                onRetry={m.retry ? () => retryForScreen(m.retry!) : undefined}
                actionLabel={m.kind === 'limited' || m.kind === 'disabled' ? 'Browse services' : m.kind === 'auth' ? 'Sign in again' : undefined}
                onAction={m.kind === 'limited' || m.kind === 'disabled' ? () => router.replace('/') : m.kind === 'auth' ? () => router.replace('/login') : undefined}
              />
            )
          ) : (
            <>
              <ProgressSteps rows={m.progress} live={false} lang={uiLanguage(m.language)} elapsedMs={m.elapsedMs} />
              {m.text ? <AssistantBubble text={m.text} /> : null}
              {m.cards.map((c, i) => {
                const draft = m.cards.find((x): x is DraftCard => x.type === 'draft');
                const key = `${m.id}-${c.type}-${i}`;
                switch (c.type) {
                  case 'safety':
                    return <SafetyCardView key={key} card={c} />;
                  case 'diagnosis':
                    return <DiagnosisCardView key={key} card={c} />;
                  case 'estimate':
                    return <EstimateCardView key={key} card={c} />;
                  case 'providers':
                    return (
                      <ProvidersCardView
                        key={key}
                        card={c}
                        onOpen={(p) => {
                          if (conversationGeneration.isCurrent(screenGeneration)) router.push({ pathname: '/provider/[id]', params: { id: p.provider_id } });
                        }}
                        onBook={(p) => bookProForScreen(p, draft)}
                      />
                    );
                  case 'draft':
                    return <DraftCardView key={key} card={c} onReview={() => reviewDraftForScreen(c)} />;
                  default:
                    return null;
                }
              })}
              {m.handoff ? (
                <HandoffCard
                  reason={m.handoff}
                  requestId={m.requestId}
                  onContact={(channel) => {
                    if (conversationGeneration.isCurrent(screenGeneration)) track('support_handoff', { reason: m.handoff, channel });
                  }}
                />
              ) : null}
              {m.messageId != null ? <FeedbackBar value={m.feedback} onRate={(r, reason) => rateForScreen(m.id, m.messageId, r, reason)} /> : null}
            </>
          )}
        </Animated.View>
      ))}
      {busy ? <ProgressSteps rows={progress} live lang={lang} elapsedMs={null} generic={generic} /> : null}
    </Screen>
  );
}
