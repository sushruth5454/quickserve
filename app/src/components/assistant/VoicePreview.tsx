import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { uiText, type UiLang } from '../../lib/assistant/progress';
import type { Transcription } from '../../lib/assistant/types';
import { useTheme } from '../../theme';
import { Button, Text } from '../ui';

/** Seconds a clear transcript stays on screen for review before it is sent automatically. */
export const AUTO_SEND_SECONDS = 4;

const COPY: Record<UiLang, { unclear: string; partial: string; sending: (s: number) => string; translated: string }> = {
  en: {
    unclear: "Couldn't hear that clearly. Please repeat or type your message.",
    partial: "Some words weren't clear. Check and edit before sending.",
    sending: (s) => `Sending in ${s}s…`,
    translated: 'Translated',
  },
  hi: {
    unclear: 'साफ़ सुनाई नहीं दिया। कृपया फिर से बोलें या टाइप करें।',
    partial: 'कुछ शब्द साफ़ नहीं थे। भेजने से पहले जांच लें।',
    sending: (s) => `${s} सेकंड में भेज रहे हैं…`,
    translated: 'अनुवाद',
  },
  te: {
    unclear: 'స్పష్టంగా వినిపించలేదు. దయచేసి మళ్లీ చెప్పండి లేదా టైప్ చేయండి.',
    partial: 'కొన్ని పదాలు స్పష్టంగా లేవు. పంపే ముందు సరిచూడండి.',
    sending: (s) => `${s} సెకన్లలో పంపుతున్నాం…`,
    translated: 'అనువాదం',
  },
};

/**
 * Voice review step (WhatsApp/ChatGPT pattern): the transcript is shown before anything is sent. A clear transcript
 * auto-sends after a short countdown unless the customer taps Edit; partial/unclear audio never auto-sends.
 */
export function VoicePreview({
  transcription,
  lang,
  onSend,
  onDiscard,
  onRetry,
}: {
  /** null while the clip is being transcribed */
  transcription: Transcription | null;
  lang: UiLang;
  onSend: (text: string, edited: boolean) => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const c = COPY[lang];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [left, setLeft] = useState(AUTO_SEND_SECONDS);
  const sent = useRef(false);
  const bar = useSharedValue(1);
  const original = transcription?.transcript_original ?? '';
  const autoSend = !!transcription && transcription.clarity === 'clear' && !!original && !editing;

  useEffect(() => {
    setText(original);
    setEditing(false);
    setLeft(AUTO_SEND_SECONDS);
    sent.current = false;
  }, [original]);

  const send = (value: string) => {
    if (sent.current || !value.trim()) return;
    sent.current = true;
    onSend(value.trim(), value.trim() !== original.trim());
  };

  useEffect(() => {
    if (!autoSend) {
      cancelAnimation(bar);
      return;
    }
    bar.value = 1;
    if (!reduced) bar.value = withTiming(0, { duration: AUTO_SEND_SECONDS * 1000, easing: Easing.linear });
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const go = setTimeout(() => send(original), AUTO_SEND_SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
      cancelAnimation(bar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, original, reduced]);
  const barStyle = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));

  const box = { borderRadius: 18, borderWidth: 1, borderColor: t.colors.outline, backgroundColor: t.colors.surface, padding: t.spacing.md, gap: t.spacing.sm } as const;

  if (!transcription) {
    return (
      <View style={[box, { flexDirection: 'row', alignItems: 'center' }]} accessibilityLiveRegion="polite">
        <Ionicons name="mic" size={18} color={t.colors.primary} />
        <Text variant="subhead" color="textSecondary" style={{ flex: 1 }}>
          {uiText('transcribing', lang)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel voice message" onPress={onDiscard} hitSlop={10} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={20} color={t.colors.muted} />
        </Pressable>
      </View>
    );
  }

  if (!original) {
    return (
      <View style={box} accessibilityLiveRegion="assertive">
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
          <Ionicons name="ear-outline" size={18} color={t.colors.warningText} />
          <Text variant="subhead" color="warningText" style={{ flex: 1 }}>
            {c.unclear}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Button title="Record again" size="sm" leftIcon="mic" onPress={onRetry} />
          <Button title="Type instead" size="sm" variant="outline" onPress={onDiscard} />
        </View>
      </View>
    );
  }

  return (
    <View style={box}>
      {transcription.clarity !== 'clear' ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
          <Ionicons name="ear-outline" size={16} color={t.colors.warningText} />
          <Text variant="caption" color="warningText" style={{ flex: 1 }}>
            {c.partial}
          </Text>
        </View>
      ) : null}
      {editing ? (
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          multiline
          maxLength={1000}
          accessibilityLabel="Edit what you said"
          style={{ color: t.colors.text, fontFamily: t.fontFamily.regular, fontSize: 16, lineHeight: 22, minHeight: 44, maxHeight: 140, padding: 0 }}
        />
      ) : (
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }} accessible accessibilityLabel={`You said: ${original}${transcription.transcript_en ? `. ${c.translated}: ${transcription.transcript_en}` : ''}`}>
          <Ionicons name="mic" size={16} color={t.colors.primary} style={{ marginTop: 3 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="callout">{original}</Text>
            {transcription.transcript_en ? (
              <Text variant="caption" color="muted">
                {c.translated}: {transcription.transcript_en}
              </Text>
            ) : null}
          </View>
        </View>
      )}
      {autoSend ? (
        <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
          <View style={{ height: 3, borderRadius: 2, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
            <Animated.View style={[{ height: 3, backgroundColor: t.colors.primary }, barStyle]} />
          </View>
          <Text variant="micro" color="muted">
            {c.sending(left)}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <Button title="Send" size="sm" leftIcon="arrow-up" onPress={() => send(text)} disabled={!text.trim()} />
            <Button title="Cancel" size="sm" variant="outline" onPress={() => { setText(original); setEditing(false); }} />
          </>
        ) : (
          <>
            <Button title="Edit" size="sm" variant="outline" leftIcon="create-outline" onPress={() => setEditing(true)} accessibilityHint="Stops auto-send so you can correct the words" />
            <Button title="Send now" size="sm" leftIcon="arrow-up" onPress={() => send(original)} />
            <Button title="Discard" size="sm" variant="ghost" onPress={onDiscard} />
          </>
        )}
      </View>
    </View>
  );
}
