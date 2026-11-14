import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { progressSummary, stageLabel, uiText, type ProgressRow, type UiLang } from '../../lib/assistant/progress';
import { useTheme } from '../../theme';
import { Text } from '../ui';
import { AssistantAvatar } from './ChatBits';

function Pulse({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    o.value = withRepeat(withTiming(0.45, { duration: 650 }), -1, true);
    return () => cancelAnimation(o);
  }, [o, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function StepIcon({ status }: { status: ProgressRow['status'] }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  if (status === 'done') return <Ionicons name="checkmark-circle" size={18} color={t.colors.success} />;
  if (status === 'failed') return <Ionicons name="remove-circle-outline" size={18} color={t.colors.muted} />;
  return reduced ? <Ionicons name="ellipse-outline" size={18} color={t.colors.primary} /> : <ActivityIndicator size="small" color={t.colors.primary} style={{ width: 18, height: 18 }} />;
}

/**
 * Live checklist of what the assistant is actually doing (rows come only from server stage events). After the answer
 * it collapses to "Done in 3.2s · 4 steps"; tap to expand. With no stream (fallback) it shows a generic working state.
 */
export function ProgressSteps({
  rows,
  live,
  lang,
  elapsedMs,
  generic,
}: {
  rows: ProgressRow[];
  live: boolean;
  lang: UiLang;
  elapsedMs: number | null;
  /** Streaming unavailable: show "Working on it…" instead of steps. */
  generic?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  if (live && (generic || !rows.length)) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }} accessibilityLiveRegion="polite" accessibilityLabel={uiText('working', lang)}>
        <AssistantAvatar />
        <Pulse>
          <Text variant="caption" color="muted">
            {uiText('working', lang)}
          </Text>
        </Pulse>
      </View>
    );
  }
  if (!rows.length) return null;

  const list = (
    <View style={{ gap: 6 }}>
      {rows.map((r) => {
        const label = stageLabel(r.key, lang, r.serverLabel);
        return (
          <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }} accessible accessibilityLabel={`${label}: ${r.status === 'active' ? 'in progress' : r.status === 'done' ? 'done' : 'skipped'}`}>
            <StepIcon status={r.status} />
            {r.status === 'active' ? (
              <Pulse>
                <Text variant="footnoteStrong" color="text">
                  {label}
                </Text>
              </Pulse>
            ) : (
              <Text variant="footnote" color={r.status === 'done' ? 'textSecondary' : 'muted'}>
                {label}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );

  if (live) {
    const active = rows.find((r) => r.status === 'active');
    return (
      <View
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}
        accessibilityLiveRegion="polite"
        accessibilityLabel={active ? stageLabel(active.key, lang, active.serverLabel) : uiText('working', lang)}
      >
        <AssistantAvatar />
        <View style={{ flex: 1, paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.md, borderRadius: 16, backgroundColor: t.colors.bubbleTheirs }}>{list}</View>
      </View>
    );
  }

  const summary = progressSummary(elapsedMs ?? 0, rows, lang);
  return (
    <View style={{ marginLeft: 36, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${summary}. ${open ? 'Hide steps' : 'Show steps'}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        hitSlop={10}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, alignSelf: 'flex-start' }}
      >
        <Ionicons name="checkmark-done-outline" size={14} color={t.colors.muted} />
        <Text variant="caption" color="muted">
          {summary}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={t.colors.muted} />
      </Pressable>
      {open ? list : null}
    </View>
  );
}
