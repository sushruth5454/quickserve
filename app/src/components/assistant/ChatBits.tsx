import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { FeedbackReason } from '../../lib/assistant/history';
import type { StarterPrompt } from '../../lib/assistant/suggestions';
import type { HandoffReason } from '../../lib/assistant/types';
import { supportContact } from '../../lib/config';
import { useTheme } from '../../theme';
import { Button, Chip, Text } from '../ui';

export function AssistantAvatar({ size = 28 }: { size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name="sparkles" size={Math.round(size * 0.55)} color={t.colors.primaryText} />
    </View>
  );
}

export function UserBubble({
  text,
  voice,
  pending,
  translated,
  photoUri,
}: {
  text: string;
  voice?: boolean;
  pending?: boolean;
  /** English translation of a voice turn spoken in another language. */
  translated?: string | null;
  photoUri?: string | null;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: t.colors.surfaceAlt }}
          contentFit="cover"
          accessibilityLabel="Photo you attached"
        />
      ) : null}
      {text ? (
        <View
          accessible
          accessibilityLabel={`${voice ? 'Voice message: ' : ''}${text}${translated ? `. Translated: ${translated}` : ''}`}
          style={{
            maxWidth: '85%',
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.sm + 2,
            borderRadius: 18,
            borderBottomRightRadius: 6,
            backgroundColor: t.colors.bubbleMine,
            gap: 4,
            opacity: pending ? 0.75 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
            {voice ? <Ionicons name="mic" size={14} color="#FFFFFF" style={{ marginTop: 3 }} /> : null}
            <Text variant="callout" style={{ color: '#FFFFFF', flexShrink: 1 }}>
              {text}
            </Text>
          </View>
          {translated ? (
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.82)' }}>
              Translated: {translated}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export type FeedbackValue = 1 | -1 | null;

const REASONS: { code: FeedbackReason; label: string }[] = [
  { code: 'wrong_service', label: 'Wrong service' },
  { code: 'wrong_price', label: 'Price looks wrong' },
  { code: 'wrong_pro', label: 'Wrong pro' },
  { code: 'language', label: 'Language' },
  { code: 'not_helpful', label: 'Not helpful' },
  { code: 'unsafe', label: 'Unsafe advice' },
];

/** Thumbs up/down for one answer, with optional fixed reasons (no free text, so no PII). */
export function FeedbackBar({ value, onRate }: { value: FeedbackValue; onRate: (rating: 1 | -1, reason: FeedbackReason | null) => void }) {
  const t = useTheme();
  const [askWhy, setAskWhy] = useState(false);
  const thumb = (rating: 1 | -1) => {
    const on = value === rating;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rating === 1 ? 'Helpful' : 'Not helpful'}
        accessibilityState={{ selected: on }}
        onPress={() => {
          onRate(rating, null);
          setAskWhy(rating === -1);
        }}
        hitSlop={8}
        style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name={rating === 1 ? (on ? 'thumbs-up' : 'thumbs-up-outline') : on ? 'thumbs-down' : 'thumbs-down-outline'} size={18} color={on ? t.colors.primaryText : t.colors.muted} />
      </Pressable>
    );
  };
  return (
    <View style={{ marginLeft: 28, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {thumb(1)}
        {thumb(-1)}
      </View>
      {askWhy && value === -1 ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" color="muted">
            What went wrong? (optional)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {REASONS.map((r) => (
              <Chip
                key={r.code}
                label={r.label}
                onPress={() => {
                  onRate(-1, r.code);
                  setAskWhy(false);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const HANDOFF_COPY: Record<HandoffReason, string> = {
  safety: 'Unsure what to do safely? Our support team can help.',
  low_confidence: "Not sure this is right? Talk to a person on our support team.",
  frustrated: "Sorry this isn't helping. Our support team can take it from here.",
  asked_human: 'Talk to a person on the QuickServe support team.',
};

/** "Talk to support" handoff, offered by the server (safety, low confidence, frustration or on request). */
export function HandoffCard({ reason, requestId, onContact }: { reason: HandoffReason; requestId: string | null; onContact?: (channel: string) => void }) {
  const t = useTheme();
  const ref = requestId ? ` (ref ${requestId.slice(0, 8)})` : '';
  const open = (channel: string, url: string) => {
    onContact?.(channel);
    void Linking.openURL(url).catch(() => undefined);
  };
  return (
    <View
      style={{ marginLeft: 36, borderRadius: 14, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.md, gap: t.spacing.sm, backgroundColor: t.colors.surface }}
      accessibilityRole="summary"
    >
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
        <Ionicons name="people-outline" size={18} color={t.colors.primaryText} />
        <Text variant="subhead" style={{ flex: 1 }}>
          {HANDOFF_COPY[reason]}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
        {supportContact.phone ? <Button title="Call support" size="sm" variant="outline" leftIcon="call-outline" onPress={() => open('phone', `tel:${supportContact.phone}`)} /> : null}
        {supportContact.whatsapp ? (
          <Button
            title="WhatsApp"
            size="sm"
            variant="outline"
            leftIcon="logo-whatsapp"
            onPress={() => open('whatsapp', `https://wa.me/${supportContact.whatsapp}?text=${encodeURIComponent(`Hi QuickServe, I need help${ref}.`)}`)}
          />
        ) : null}
        <Button
          title="Email support"
          size="sm"
          variant="outline"
          leftIcon="mail-outline"
          onPress={() => open('email', `mailto:${supportContact.email}?subject=${encodeURIComponent(`QuickServe AI help${ref}`)}`)}
        />
      </View>
    </View>
  );
}

export function AssistantBubble({
  text,
  error,
  onRetry,
  actionLabel,
  onAction,
}: {
  text: string;
  error?: boolean;
  onRetry?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
      <AssistantAvatar />
      <View
        style={{
          maxWidth: '85%',
          flexShrink: 1,
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.sm + 2,
          borderRadius: 18,
          borderBottomLeftRadius: 6,
          backgroundColor: error ? t.colors.dangerSoft : t.colors.bubbleTheirs,
          gap: t.spacing.sm,
        }}
      >
        <Text variant="callout" color={error ? 'dangerText' : 'text'}>
          {text}
        </Text>
        {onRetry ? <Button title="Try again" size="sm" variant="outline" leftIcon="refresh" onPress={onRetry} /> : null}
        {actionLabel && onAction ? <Button title={actionLabel} size="sm" variant="outline" onPress={onAction} /> : null}
      </View>
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const t = useTheme();
  const o = useSharedValue(0.3);
  useEffect(() => {
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 300 }), withTiming(0.3, { duration: 300 })), -1));
  }, [delay, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.colors.muted }, style]} />;
}

export function TypingIndicator({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <AssistantAvatar />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingHorizontal: t.spacing.md,
          height: 38,
          borderRadius: 18,
          borderBottomLeftRadius: 6,
          backgroundColor: t.colors.bubbleTheirs,
        }}
      >
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </View>
      <Text variant="caption" color="muted" style={{ marginBottom: 10 }}>
        {label}
      </Text>
    </View>
  );
}

export function QuickReplies({ items, onPick, disabled }: { items: string[]; onPick: (s: string) => void; disabled?: boolean }) {
  const t = useTheme();
  if (!items.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginHorizontal: -t.spacing.lg }}
      contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}
    >
      {items.map((q) => (
        <Chip key={q} label={q} onPress={() => onPick(q)} disabled={disabled} />
      ))}
    </ScrollView>
  );
}

export function StarterList({ items, onPick }: { items: StarterPrompt[]; onPick: (p: StarterPrompt) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm, marginLeft: 36 }}>
      {items.map((p) => (
        <Pressable
          key={p.label}
          accessibilityRole="button"
          accessibilityLabel={p.label}
          onPress={() => onPick(p)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.md,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.md,
            borderRadius: t.radii.md,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
          })}
        >
          <Ionicons name={p.icon} size={18} color={t.colors.primaryText} />
          <Text variant="subhead" style={{ flex: 1 }}>
            {p.label}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={t.colors.subtle} />
        </Pressable>
      ))}
    </View>
  );
}
