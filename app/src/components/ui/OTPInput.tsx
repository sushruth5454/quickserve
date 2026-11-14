import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Text } from './Text';

interface Props {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  secure?: boolean;
}

/**
 * One hidden TextInput drives N boxes: typing auto-advances, backspace goes back, and pasting or SMS autofill
 * of the full code works natively.
 */
export function OTPInput({ length = 6, value, onChange, onComplete, error, autoFocus, accessibilityLabel, secure }: Props) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const shake = useSharedValue(0);
  const caret = useSharedValue(1);

  useEffect(() => {
    if (error && !reduceMotion) {
      shake.value = withSequence(
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(-6, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    }
  }, [error, shake, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    caret.value = withRepeat(withSequence(withTiming(0, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
  }, [caret, reduceMotion]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }));

  const handle = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  const maxBox = length > 4 ? 52 : 64;
  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessible={false}
      style={{ alignSelf: 'stretch', backgroundColor: 'transparent' }}
    >
      <Animated.View
        style={[{ flexDirection: 'row', gap: t.spacing.sm, justifyContent: 'center', alignSelf: 'stretch' }, rowStyle]}
      >
        {Array.from({ length }).map((_, i) => {
          const ch = value[i];
          const isActive = focused && (i === value.length || (i === length - 1 && value.length === length));
          return (
            <View
              key={i}
              style={{
                flex: 1,
                maxWidth: maxBox,
                height: 56,
                borderRadius: t.radii.md,
                borderWidth: isActive || error ? 2 : 1,
                borderColor: error ? t.colors.danger : isActive ? t.colors.primary : t.colors.outline,
                backgroundColor: error ? t.colors.dangerSoft : t.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isActive ? `0px 0px 0px 3px ${t.colors.primarySoft}` : undefined,
              }}
            >
              {ch ? (
                <Text variant="title1" tabular style={{ fontFamily: t.fontFamily.semibold }} maxFontSizeMultiplier={1.2}>
                  {secure ? '•' : ch}
                </Text>
              ) : isActive ? (
                <Animated.View style={[{ width: 2, height: 24, borderRadius: 1, backgroundColor: t.colors.primary }, caretStyle]} />
              ) : null}
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={length === 6 ? 'sms-otp' : 'off'}
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        accessibilityLabel={accessibilityLabel ?? `${length}-digit code`}
        style={
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: Platform.OS === 'web' ? 0.011 : 0,
            color: 'transparent',
            backgroundColor: 'transparent',
            borderWidth: 0,
            outlineStyle: 'none',
          } as never
        }
      />
    </Pressable>
  );
}
