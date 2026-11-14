import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { StarterPrompt } from '../../lib/assistant/suggestions';
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

export function UserBubble({ text, voice, pending }: { text: string; voice?: boolean; pending?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View
        style={{
          maxWidth: '85%',
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.sm + 2,
          borderRadius: 18,
          borderBottomRightRadius: 6,
          backgroundColor: t.colors.bubbleMine,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pending ? 0.75 : 1,
        }}
      >
        {voice ? <Ionicons name="mic" size={14} color="#FFFFFF" /> : null}
        <Text variant="callout" style={{ color: '#FFFFFF', flexShrink: 1 }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

export function AssistantBubble({ text, error, onRetry }: { text: string; error?: boolean; onRetry?: () => void }) {
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
