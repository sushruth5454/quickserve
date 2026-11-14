import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { DiagnosisCardView, DraftCardView, EstimateCardView, ProvidersCardView, SafetyCardView } from '../src/components/assistant/AssistantCards';
import { AssistantBubble, QuickReplies, StarterList, TypingIndicator, UserBubble } from '../src/components/assistant/ChatBits';
import { Composer } from '../src/components/assistant/Composer';
import { EmptyState, Header, IconButton, Screen, Text, useToast } from '../src/components/ui';
import { getMyProfile, listMyBookings } from '../src/lib/api';
import { AssistantError, sendToAssistant } from '../src/lib/assistant/client';
import type { AssistantErrorKind } from '../src/lib/assistant/parse';
import { aiAssistantEnabled } from '../src/lib/config';
import { locationTitle } from '../src/lib/locationModel';
import { draftToBookParams } from '../src/lib/assistant/prefill';
import { starterPrompts, type StarterPrompt } from '../src/lib/assistant/suggestions';
import type { AssistantCard, DraftCard, ProviderPick } from '../src/lib/assistant/types';
import { useSelectedLocation } from '../src/lib/locationContext';
import { useTheme } from '../src/theme';

type Msg =
  | { id: string; role: 'user'; text: string; voice?: boolean; pending?: boolean }
  | { id: string; role: 'assistant'; text: string; cards: AssistantCard[]; quickReplies: string[] }
  | { id: string; role: 'error'; text: string; retry: Retry | null; kind: AssistantErrorKind; requestId: string | null };

type Retry = { message?: string; audio?: { data: string; mimeType: string; durationMs: number } };

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${seq++}`;

export default function AssistantScreen() {
  const t = useTheme();
  const toast = useToast();
  const { location } = useSelectedLocation();
  const params = useLocalSearchParams<{ q?: string; category?: string; name?: string }>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starters, setStarters] = useState<StarterPrompt[]>(() => starterPrompts([], new Date()));
  const [firstName, setFirstName] = useState('');
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const autoSent = useRef(false);

  useEffect(() => {
    void Promise.all([listMyBookings().catch(() => []), getMyProfile().catch(() => null)]).then(([bookings, profile]) => {
      const list = starterPrompts(bookings, new Date());
      // Opened from a category's results: lead with that service.
      if (params.category && params.name) {
        list.unshift({
          label: `Help me choose a ${params.name} pro`,
          message: `I need a ${params.name}. Help me pick the right pro.`,
          icon: 'chatbubble-ellipses-outline',
        });
      }
      setStarters(list.slice(0, 4));
      setFirstName(profile?.full_name?.split(' ')[0] ?? '');
    });
  }, []);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

  const send = useCallback(
    async (input: Retry) => {
      if (busy) return;
      const userId = nextId();
      const voice = !!input.audio;
      const secs = input.audio ? Math.max(1, Math.round(input.audio.durationMs / 1000)) : 0;
      setMessages((m) => [
        ...m.filter((x) => x.role !== 'error'),
        { id: userId, role: 'user', text: voice ? `Voice message (0:${String(secs).padStart(2, '0')})` : input.message!, voice, pending: voice },
      ]);
      setBusy(true);
      scrollToEnd();
      try {
        const reply = await sendToAssistant({
          conversationId,
          message: input.message,
          audio: input.audio ? { data: input.audio.data, mimeType: input.audio.mimeType } : undefined,
          location: { area: location.area, city: location.city, lat: location.lat, lng: location.lng, address_id: location.addressId },
        });
        if (reply.conversation_id) setConversationId(reply.conversation_id);
        setMessages((m) => [
          ...m.map((x) => (x.id === userId && x.role === 'user' ? { ...x, text: reply.transcript ?? x.text, pending: false } : x)),
          { id: nextId(), role: 'assistant', text: reply.reply_text, cards: reply.cards, quickReplies: reply.quick_replies },
        ]);
        if (reply.limits && reply.limits.messages_left <= 3) {
          toast({ message: `${reply.limits.messages_left} AI messages left today`, tone: 'warning' });
        }
      } catch (e) {
        const err = e instanceof AssistantError ? e : new AssistantError('Something went wrong. Please try again.', 'internal', 'retry');
        const retryable = err.kind === 'retry' || err.kind === 'offline';
        setMessages((m) => [
          ...m.filter((x) => x.id !== userId || !voice),
          { id: nextId(), role: 'error', text: err.message, retry: retryable ? input : null, kind: err.kind, requestId: err.requestId },
        ]);
      } finally {
        setBusy(false);
        scrollToEnd();
      }
    },
    [busy, conversationId, location, toast],
  );

  // Home search ("Ask QuickServe AI" with text) opens the chat with the question already sent.
  useEffect(() => {
    if (autoSent.current || !params.q?.trim()) return;
    autoSent.current = true;
    void send({ message: params.q.trim().slice(0, 1000) });
  }, [params.q, send]);

  const reviewDraft = (d: DraftCard) => router.push({ pathname: '/book/[providerServiceId]', params: draftToBookParams(d) });

  const bookPro = (p: ProviderPick, draft: DraftCard | undefined) => {
    if (draft) {
      reviewDraft({ ...draft, provider: { ...draft.provider, provider_id: p.provider_id, provider_service_id: p.provider_service_id, name: p.name, visit_fee: p.visit_fee } });
    } else {
      router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: p.provider_service_id } });
    }
  };

  const newChat = () => {
    setMessages([]);
    setConversationId(null);
  };

  if (!aiAssistantEnabled) {
    return (
      <Screen header={<Header title="QuickServe AI" />}>
        <EmptyState
          icon="sparkles-outline"
          title="QuickServe AI is not available"
          message="You can still find a pro and book from the service list."
          actionLabel="Browse services"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const quickReplies = !busy && lastAssistant?.role === 'assistant' && messages[messages.length - 1] === lastAssistant ? lastAssistant.quickReplies : [];

  return (
    <Screen
      header={
        <Header
          title="QuickServe AI"
          subtitle="Describe the problem. I'll find the right pro."
          right={messages.length ? <IconButton icon="create-outline" accessibilityLabel="New chat" onPress={newChat} /> : undefined}
        />
      }
      scrollRef={scrollRef}
      gap={t.spacing.lg}
      scrollProps={{ onContentSizeChange: () => scrollRef.current?.scrollToEnd({ animated: false }) }}
      footer={
        <View style={{ gap: t.spacing.sm }}>
          <QuickReplies items={quickReplies} onPick={(q) => void send({ message: q })} disabled={busy} />
          <Composer
            busy={busy}
            onSend={(text) => void send({ message: text })}
            onVoice={(audio) => void send({ audio })}
            onVoiceError={(message) => toast({ message, tone: 'error' })}
          />
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
          paddingVertical: 6,
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
      {messages.length === 0 && !params.q ? <StarterList items={starters} onPick={(p) => void send({ message: p.message })} /> : null}

      {messages.map((m) => (
        <Animated.View key={m.id} entering={FadeInDown.duration(220)} style={{ gap: t.spacing.md }}>
          {m.role === 'user' ? (
            <UserBubble text={m.text} voice={m.voice} pending={m.pending} />
          ) : m.role === 'error' ? (
            <AssistantBubble
              text={m.requestId ? ` (Ref )` : m.text}
              error
              onRetry={m.retry ? () => void send(m.retry!) : undefined}
              actionLabel={m.kind === 'limited' || m.kind === 'disabled' ? 'Browse services' : m.kind === 'auth' ? 'Sign in again' : undefined}
              onAction={m.kind === 'limited' || m.kind === 'disabled' ? () => router.replace('/') : m.kind === 'auth' ? () => router.replace('/login') : undefined}
            />
          ) : (
            <>
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
            </>
          )}
        </Animated.View>
      ))}
      {busy ? <TypingIndicator label={messages[messages.length - 1]?.role === 'user' && (messages[messages.length - 1] as { voice?: boolean }).voice ? 'Listening…' : 'Thinking…'} /> : null}
    </Screen>
  );
}
