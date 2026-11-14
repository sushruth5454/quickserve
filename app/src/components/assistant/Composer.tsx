import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { isDemoMode } from '../../lib/config';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { Text } from '../ui';
import { TextComposer, type ComposerProps } from './TextComposer';

/** Voice messages are capped at 60 s (server rejects larger uploads; Gemini bills audio by length). */
export const MAX_RECORDING_MS = 60_000;

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function VoiceComposer({ busy, onSend, onVoice, onVoiceError, onMicDenied, onStop, attach, canSendEmpty }: ComposerProps) {
  const t = useTheme();
  // HIGH_QUALITY records AAC in an .m4a container on iOS and Android (a format Gemini accepts as audio/m4a).
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);
  const stopping = useRef(false);

  const start = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        if (onMicDenied) onMicDenied();
        else onVoiceError('Microphone access is off. Allow it in Settings to talk to QuickServe AI, or type instead.');
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      stopping.current = false;
      setRecording(true);
      haptics.tap();
    } catch (e) {
      onVoiceError((e as Error).message || 'Could not start recording.');
    }
  };

  const stop = useCallback(
    async (send: boolean) => {
      if (stopping.current) return;
      stopping.current = true;
      const durationMs = state.durationMillis ?? 0;
      try {
        await recorder.stop();
      } catch {
        // already stopped
      }
      setRecording(false);
      void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
      const uri = recorder.uri;
      if (!send || !uri) return;
      if (durationMs < 700) {
        onVoiceError('That was too short. Hold on and speak for a second or two.');
        return;
      }
      try {
        const file = new File(uri);
        const data = await file.base64();
        try {
          file.delete();
        } catch {
          // cache file; the OS cleans it up
        }
        onVoice({ data, mimeType: 'audio/m4a', durationMs: Math.min(durationMs, MAX_RECORDING_MS) });
      } catch (e) {
        onVoiceError((e as Error).message || 'Could not read the recording.');
      }
    },
    [recorder, state.durationMillis, onVoice, onVoiceError],
  );

  useEffect(() => {
    if (recording && (state.durationMillis ?? 0) >= MAX_RECORDING_MS) void stop(true);
  }, [recording, state.durationMillis, stop]);

  if (recording) {
    const left = Math.max(0, MAX_RECORDING_MS - (state.durationMillis ?? 0));
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }} accessibilityLiveRegion="polite">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel recording"
          onPress={() => void stop(false)}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? t.colors.dangerSoft : t.colors.surfaceAlt,
          })}
        >
          <Ionicons name="trash-outline" size={20} color={t.colors.dangerText} />
        </Pressable>
        <View
          style={{
            flex: 1,
            height: 44,
            borderRadius: 22,
            backgroundColor: t.colors.dangerSoft,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: t.spacing.lg,
            gap: t.spacing.sm,
          }}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.danger }} />
          <Text variant="subheadStrong" color="dangerText" tabular>
            {mmss(state.durationMillis ?? 0)}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            Listening… {left < 10_000 ? `${Math.ceil(left / 1000)} s left` : 'tap send when done'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send voice message"
          onPress={() => void stop(true)}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? t.colors.primaryPressed : t.colors.primary,
          })}
        >
          <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    );
  }

  return (
    <TextComposer
      busy={busy}
      onSend={onSend}
      onStop={onStop}
      attach={attach}
      canSendEmpty={canSendEmpty}
      mic={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Speak your message"
          accessibilityHint="Records up to 60 seconds in English, Hindi or Telugu"
          disabled={busy}
          onPress={() => void start()}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? t.colors.primaryPressed : t.colors.primary,
            opacity: busy ? 0.5 : 1,
          })}
        >
          <Ionicons name="mic" size={20} color="#FFFFFF" />
        </Pressable>
      }
    />
  );
}

export function Composer(props: ComposerProps) {
  return isDemoMode ? (
    <TextComposer busy={props.busy} onSend={props.onSend} onStop={props.onStop} attach={props.attach} canSendEmpty={props.canSendEmpty} />
  ) : (
    <VoiceComposer {...props} />
  );
}
