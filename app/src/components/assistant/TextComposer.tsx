import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useTheme } from '../../theme';

export interface ComposerProps {
  busy: boolean;
  onSend: (text: string) => void;
  onVoice: (audio: { data: string; mimeType: string; durationMs: number }) => void;
  onVoiceError: (message: string) => void;
  /** Microphone permission was refused: the screen shows how to enable it in Settings. */
  onMicDenied?: () => void;
  /** Shown instead of Send while the assistant works. */
  onStop?: () => void;
  /** Left slot (photo attach button). */
  attach?: ReactNode;
  /** A photo is attached, so an empty text can still be sent. */
  canSendEmpty?: boolean;
}

export const MAX_MESSAGE = 1000;

/** Text box + send button; `mic` is the voice button slot (native only). */
export function TextComposer({
  busy,
  onSend,
  mic,
  onStop,
  attach,
  canSendEmpty,
}: Pick<ComposerProps, 'busy' | 'onSend' | 'onStop' | 'attach' | 'canSendEmpty'> & { mic?: ReactNode }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const canSend = (!!text.trim() || !!canSendEmpty) && !busy;
  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
      {attach}
      <View
        style={{
          flex: 1,
          minHeight: 44,
          maxHeight: 120,
          justifyContent: 'center',
          borderRadius: 22,
          borderWidth: 1,
          borderColor: t.colors.outline,
          backgroundColor: t.colors.surface,
          paddingHorizontal: t.spacing.lg,
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Describe the problem…"
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Message QuickServe AI"
          maxLength={MAX_MESSAGE}
          multiline
          numberOfLines={Platform.OS === 'web' ? 1 : undefined}
          onSubmitEditing={submit}
          returnKeyType="send"
          submitBehavior="submit"
          style={
            {
              color: t.colors.text,
              fontFamily: t.fontFamily.regular,
              fontSize: 16,
              lineHeight: 22,
              paddingVertical: 10,
              maxHeight: 110,
              outlineStyle: 'none',
            } as never
          }
        />
      </View>
      {busy && onStop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop generating"
          onPress={onStop}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
            borderWidth: 1.5,
            borderColor: t.colors.borderStrong,
          })}
        >
          <Ionicons name="stop" size={18} color={t.colors.text} />
        </Pressable>
      ) : mic && !text.trim() && !canSendEmpty ? (
        mic
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          hitSlop={4}
          onPress={submit}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSend ? (pressed ? t.colors.primaryPressed : t.colors.primary) : t.colors.surfaceAlt,
          })}
        >
          <Ionicons name="arrow-up" size={20} color={canSend ? '#FFFFFF' : t.colors.subtle} />
        </Pressable>
      )}
    </View>
  );
}
