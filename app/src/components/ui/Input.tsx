import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  helper?: string;
  error?: string | null;
  prefix?: string;
  leftIcon?: IconName;
  right?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps['style'];
  size?: 'md' | 'lg';
}

export const Input = forwardRef<ComponentRef<typeof TextInput>, InputProps>(function Input(
  { label, helper, error, prefix, leftIcon, right, containerStyle, inputStyle, size = 'md', multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? t.colors.danger : focused ? t.colors.primary : t.colors.border;
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? (
        <Text variant="captionStrong" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: multiline ? 112 : size === 'lg' ? 56 : 50,
          borderRadius: t.radii.md,
          borderWidth: focused || error ? 1.5 : 1,
          borderColor,
          backgroundColor: t.colors.surface,
          paddingHorizontal: t.spacing.md + 2,
          gap: t.spacing.sm,
          boxShadow: focused ? `0px 0px 0px 3px ${error ? t.colors.dangerSoft : t.colors.primarySoft}` : undefined,
        }}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={18}
            color={focused ? t.colors.primary : t.colors.muted}
            style={multiline ? { marginTop: 14 } : undefined}
          />
        ) : null}
        {prefix ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <Text variant={size === 'lg' ? 'title3' : 'bodyStrong'}>{prefix}</Text>
            <View style={{ width: 1, height: 22, backgroundColor: t.colors.border }} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={t.colors.subtle}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          maxFontSizeMultiplier={1.4}
          style={[
            {
              flex: 1,
              color: t.colors.text,
              fontFamily: size === 'lg' ? t.fontFamily.semibold : t.fontFamily.regular,
              fontSize: size === 'lg' ? 18 : 16,
              paddingVertical: multiline ? 12 : 0,
              minHeight: multiline ? 100 : 44,
              textAlignVertical: multiline ? 'top' : 'center',
              outlineStyle: 'none',
            } as never,
            inputStyle,
          ]}
          {...rest}
        />
        {right}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={14} color={t.colors.danger} />
          <Text variant="caption" color="dangerText" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text variant="caption" color="muted">
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

export const TextArea = forwardRef<ComponentRef<typeof TextInput>, InputProps & { showCount?: boolean }>(function TextArea(
  { showCount = true, maxLength, value, helper, ...rest },
  ref,
) {
  const count = showCount && maxLength ? `${(value ?? '').length}/${maxLength}` : undefined;
  return (
    <Input
      ref={ref}
      multiline
      maxLength={maxLength}
      value={value}
      helper={[helper, count].filter(Boolean).join('  ·  ') || undefined}
      {...rest}
    />
  );
});
