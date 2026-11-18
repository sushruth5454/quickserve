import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { DiagnosisCardView, DraftCardView, EstimateCardView, ProvidersCardView, SafetyCardView } from '../src/components/assistant/AssistantCards';
import { AssistantBubble, FeedbackBar, HandoffCard, QuickReplies, StarterList, UserBubble, type FeedbackValue } from '../src/components/assistant/ChatBits';
import { Composer } from '../src/components/assistant/Composer';
import { ProgressSteps } from '../src/components/assistant/ProgressSteps';
import { VoicePreview } from '../src/components/assistant/VoicePreview';
import { Button, EmptyState, Header, IconButton, Screen, Text, useToast } from '../src/components/ui';
import { track } from '../src/lib/analytics';
import { getMyProfile, listMyBookings } from '../src/lib/api';
import { AssistantError, sendToAssistant, transcribeVoice } from '../src/lib/assistant/client';
import { listConversations, loadConversation, photoUrl, setFeedback, type FeedbackReason, type StoredTurn } from '../src/lib/assistant/history';
import { visualPiiRedactionReady } from '../src/features/ai/imagePrivacy';
import type { AssistantErrorKind } from '../src/lib/assistant/parse';
import { draftToBookParams } from '../src/lib/assistant/prefill';
import { applyStage, uiLanguage, type ProgressRow } from '../src/lib/assistant/progress';
import { speak, stopSpeaking } from '../src/lib/assistant/speech';
import { starterPrompts, type StarterPrompt } from '../src/lib/assistant/suggestions';
import type { AssistantCard, AssistantLanguage, DraftCard, HandoffReason, ProviderPick, Transcription, VoiceMeta } from '../src/lib/assistant/types';
import { aiAssistantEnabled, isDemoMode } from '../src/lib/config';
import { useSelectedLocation } from '../src/lib/locationContext';
import { locationTitle } from '../src/lib/locationModel';
import { useTheme } from '../src/theme';

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
  | { id: string; role: 'error'; text: string; retry: Retry | null; kind: AssistantErrorKind; requestId: string | null };

type Retry = { message?: string; voice?: VoiceMeta; image?: { data: string; mimeType: string }; photoUri?: string | null };
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
  const toast = useToast();
  const reduced = useReducedMotion();
  const { location } = useSelectedLocation();
  const params = useLocalSearchParams<{ q?: string; category?: string; name?: string; conversation?: string }>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
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
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const autoSent = useRef(false);
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
      chatAbort.current?.abort();
      voiceAbort.current?.abort();
      stopSpeaking();
    };
  }, []);

  const openConversation = useCallback(
    async (id: string, auto: boolean) => {
      try {
        const turns = await loadConversation(id);
        if (!turns.length) return;
        setConversationId(id);
        setMessages(turnsToMessages(turns));
        setResumed(auto);
        // Private photos: short-lived signed links, owner-only (RLS).
        for (const turn of turns) {
          if (turn.role === 'user' && turn.photoPath) {
            void photoUrl(turn.photoPath).then((uri) => uri && setMessages((m) => m.map((x) => (x.id === `s${turn.id}` && x.role === 'user' ? { ...x, photoUri: uri } : x))));
          }
        }
      } catch {
        if (!auto) toast({ message: 'Could not open that conversation.', tone: 'error' });
      }
    },
    [toast],
  );

  // Resume: a conversation picked from history, else the last one if it is recent (unless opened with a new question).
  useEffect(() => {
    if (params.conversation) {
      void openConversation(params.conversation, false);
      return;
    }
    if (params.q || params.category || isDemoMode) return;
    void listConversations()
      .then((list) => {
        const last = list[0];
        if (last && Date.now() - Date.parse(last.updatedAt) < RESUME_WINDOW_MS) void openConversation(last.id, true);
      })
      .catch(() => undefined);
  }, [params.conversation]);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduced }), 80);

  const send = useCallback(
    async (input: Retry) => {
      if (busy) return;
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
      chatAbort.current = ctrl;
      let rows: ProgressRow[] = [];
      try {
        const reply = await sendToAssistant(
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
              rows = applyStage(rows, e);
              setProgress(rows);
            },
            onStart: (info) => info.conversationId && setConversationId(info.conversationId),
            onStreamUnavailable: () => setGeneric(true),
          },
        );
        if (reply.conversation_id) setConversationId(reply.conversation_id);
        const elapsedMs = reply.elapsed_ms ?? Date.now() - started;
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
        const stageMs: Record<string, number> = {};
        for (const s of reply.stages) stageMs[s.key] = (stageMs[s.key] ?? 0) + s.ms;
        track('stage_latency', { total_ms: elapsedMs, steps: reply.stages.length, streamed: rows.length > 0, stages: stageMs });
        if (reply.fallback_used) track('fallback_model_used', { total_ms: elapsedMs });
        const draft = reply.cards.find((c): c is DraftCard => c.type === 'draft');
        if (draft) track('draft_created', { category: draft.category_slug, slot: draft.slot.type, from_voice: !!input.voice, with_photo: !!input.image });
        if (readAloud && reply.reply_text) speak(reply.reply_text, reply.language);
        if (reply.limits && reply.limits.messages_left <= 3) toast({ message: `${reply.limits.messages_left} AI messages left today`, tone: 'warning' });
      } catch (e) {
        const err = e instanceof AssistantError ? e : new AssistantError('Something went wrong. Please try again.', 'internal', 'retry');
        if (err.kind === 'stopped') {
          track('assistant_stopped', { stage: rows.find((r) => r.status === 'active')?.key ?? null, after_ms: Date.now() - started });
          setMessages((m) => m.map((x) => (x.id === userId && x.role === 'user' ? { ...x, stopped: true } : x)));
        } else {
          const retryable = err.kind === 'retry' || err.kind === 'offline';
          setMessages((m) => [...m, { id: nextId(), role: 'error', text: err.message, retry: retryable ? input : null, kind: err.kind, requestId: err.requestId }]);
        }
      } finally {
        chatAbort.current = null;
        setBusy(false);
        setProgress([]);
        scrollToEnd();
      }
    },
    [busy, conversationId, location, readAloud, toast],
  );

  // Home search ("Ask QuickServe AI" with text) opens the chat with the question already sent.
  useEffect(() => {
    if (autoSent.current || !params.q?.trim()) return;
    autoSent.current = true;
    void send({ message: params.q.trim().slice(0, 1000) });
  }, [params.q, send]);

  const stop = () => chatAbort.current?.abort();

  const onVoice = async (audio: { data: string; mimeType: string; durationMs: number }) => {
    track('voice_used', { duration_s: Math.round(audio.durationMs / 1000) });
    const ctrl = new AbortController();
    voiceAbort.current = ctrl;
    setVoice({ phase: 'transcribing' });
    try {
      const tr = await transcribeVoice({ data: audio.data, mimeType: audio.mimeType }, ctrl.signal);
      setVoice({ phase: 'review', t: tr });
    } catch (e) {
      setVoice(null);
      const err = e instanceof AssistantError ? e : null;
      if (err?.kind !== 'stopped') toast({ message: err?.message ?? 'Could not process the recording. Please type instead.', tone: 'error' });
    } finally {
      voiceAbort.current = null;
    }
  };

  const sendVoice = (text: string, edited: boolean) => {
    if (voice?.phase !== 'review') return;
    const tr = voice.t;
    setVoice(null);
    void send({ message: text, voice: { transcript_original: text, transcript_en: edited ? null : tr.transcript_en, language: tr.language, edited } });
  };

  const pickPhoto = async (source: 'camera' | 'library') => {
    setAttachMenu(false);
    if (!visualPiiRedactionReady) return;
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setPermIssue('camera');
          return;
        }
      }
      // EXIF removal is not visual redaction; the server gate remains closed until visible text is scrubbed.
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, exif: false };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
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
      setPhoto({ data, mimeType: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', uri: a.uri });
      track('photo_attached', { source });
    } catch (e) {
      toast({ message: (e as Error).message || 'Could not open photos.', tone: 'error' });
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

  const reviewDraft = (d: DraftCard) => router.push({ pathname: '/book/[providerServiceId]', params: draftToBookParams(d) });

  const bookPro = (p: ProviderPick, draft: DraftCard | undefined) => {
    if (draft) {
      reviewDraft({ ...draft, provider: { ...draft.provider, provider_id: p.provider_id, provider_service_id: p.provider_service_id, name: p.name, visit_fee: p.visit_fee } });
    } else {
      router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: p.provider_service_id } });
    }
  };

  const newChat = () => {
    chatAbort.current?.abort();
    stopSpeaking();
    setMessages([]);
    setConversationId(null);
    setResumed(false);
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

  if (!aiAssistantEnabled) {
    return (
      <Screen header={<Header title="QuickServe AI" />}>
        <EmptyState icon="sparkles-outline" title="QuickServe AI is not available" message="You can still find a pro and book from the service list." actionLabel="Browse services" onAction={() => router.replace('/')} />
      </Screen>
    );
  }

  const attachButton =
    voice || busy || !visualPiiRedactionReady ? null : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={photo ? 'Change attached photo' : 'Attach a photo of the problem'}
        onPress={() => (Platform.OS === 'web' ? void pickPhoto('library') : setAttachMenu((o) => !o))}
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
              {messages.length ? <IconButton icon="create-outline" accessibilityLabel="New chat" onPress={newChat} /> : null}
            </View>
          }
        />
      }
      scrollRef={scrollRef}
      gap={t.spacing.lg}
      scrollProps={{ onContentSizeChange: () => scrollRef.current?.scrollToEnd({ animated: false }) }}
      footer={
        <View style={{ gap: t.spacing.sm }}>
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
          <QuickReplies items={quickReplies} onPick={(q) => (q === CHANGE_ADDRESS ? router.push('/location') : void send({ message: q }))} disabled={busy} />
          {attachMenu && visualPiiRedactionReady ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button title="Take photo" size="sm" variant="outline" leftIcon="camera-outline" onPress={() => void pickPhoto('camera')} />
              <Button title="Choose from gallery" size="sm" variant="outline" leftIcon="images-outline" onPress={() => void pickPhoto('library')} />
            </View>
          ) : null}
          {photo && visualPiiRedactionReady ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Image source={{ uri: photo.uri }} style={{ width: 52, height: 52, borderRadius: 10 }} contentFit="cover" accessibilityLabel="Attached photo" />
              <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
                Photo attached. Add a few words (optional) and send.
              </Text>
              <IconButton icon="close-circle" accessibilityLabel="Remove photo" onPress={() => setPhoto(null)} />
            </View>
          ) : null}
          {voice ? (
            <VoicePreview
              transcription={voice.phase === 'review' ? voice.t : null}
              lang={lang}
              onSend={sendVoice}
              onDiscard={() => {
                voiceAbort.current?.abort();
                setVoice(null);
              }}
              onRetry={() => setVoice(null)}
            />
          ) : (
            <Composer
              busy={busy}
              onSend={sendText}
              onVoice={(audio) => void onVoice(audio)}
              onVoiceError={(message) => toast({ message, tone: 'error' })}
              onMicDenied={() => setPermIssue('mic')}
              onStop={stop}
              attach={attachButton}
              canSendEmpty={!!photo && visualPiiRedactionReady}
            />
          )}
          <Text variant="micro" color="muted" align="center">
            AI can make mistakes. You always review and pay in checkout.
          </Text>
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
      {resumed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm }}>
          <Text variant="caption" color="muted">
            Continuing your last chat
          </Text>
          <Button title="New chat" size="sm" variant="ghost" onPress={newChat} />
        </View>
      ) : null}
      {messages.length === 0 && !params.q && !params.conversation ? <StarterList items={starters} onPick={(p) => void send({ message: p.message })} /> : null}

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
            <AssistantBubble
              text={m.requestId ? `${m.text} (Ref ${m.requestId.slice(0, 8)})` : m.text}
              error
              onRetry={m.retry ? () => void send(m.retry!) : undefined}
              actionLabel={m.kind === 'limited' || m.kind === 'disabled' ? 'Browse services' : m.kind === 'auth' ? 'Sign in again' : undefined}
              onAction={m.kind === 'limited' || m.kind === 'disabled' ? () => router.replace('/') : m.kind === 'auth' ? () => router.replace('/login') : undefined}
            />
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
                        onOpen={(p) => router.push({ pathname: '/provider/[id]', params: { id: p.provider_id } })}
                        onBook={(p) => bookPro(p, draft)}
                      />
                    );
                  case 'draft':
                    return <DraftCardView key={key} card={c} onReview={() => reviewDraft(c)} />;
                  default:
                    return null;
                }
              })}
              {m.handoff ? (
                <HandoffCard reason={m.handoff} requestId={m.requestId} onContact={(channel) => track('support_handoff', { reason: m.handoff, channel })} />
              ) : null}
              {m.messageId != null ? <FeedbackBar value={m.feedback} onRate={(r, reason) => rate(m.id, m.messageId, r, reason)} /> : null}
            </>
          )}
        </Animated.View>
      ))}
      {busy ? <ProgressSteps rows={progress} live lang={lang} elapsedMs={null} generic={generic} /> : null}
    </Screen>
  );
}
