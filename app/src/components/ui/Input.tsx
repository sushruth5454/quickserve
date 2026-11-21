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
  /** Right-aligned character counter under the field. */
  counter?: string;
  prefix?: string;
  leftIcon?: IconName;
  right?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps['style'];
  size?: 'md' | 'lg';
}

export const Input = forwardRef<ComponentRef<typeof TextInput>, InputProps>(function Input(
  { label, helper, error, counter, prefix, leftIcon, right, containerStyle, inputStyle, size = 'md', multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? t.colors.danger : focused ? t.colors.primary : t.colors.outline;
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? (
        <Text variant="subhead" color="textSecondary" critical>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: multiline ? 96 : size === 'lg' ? 56 : 52,
          borderRadius: t.radii.md,
          borderWidth: focused || error ? 1.5 : 1,
          borderColor,
          backgroundColor: t.colors.surface,
          paddingHorizontal: focused || error ? t.spacing.md + 1.5 : t.spacing.md + 2,
          gap: t.spacing.sm,
          boxShadow: focused ? `0px 0px 0px 3px ${error ? t.colors.dangerSoft : t.colors.primarySoft}` : undefined,
        }}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={18}
            color={focused ? t.colors.primaryText : t.colors.muted}
            style={multiline ? { marginTop: 14 } : undefined}
          />
        ) : null}
        {prefix ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <Text variant={size === 'lg' ? 'title3' : 'bodyStrong'} color="textSecondary" critical>
              {prefix}
            </Text>
            <View style={{ width: 1, height: 22, backgroundColor: t.colors.borderStrong }} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={t.colors.muted}
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
          maxFontSizeMultiplier={2}
          style={[
            {
              flex: 1,
              minWidth: 0,
              color: t.colors.text,
              fontFamily: size === 'lg' ? t.fontFamily.semibold : t.fontFamily.regular,
              fontSize: size === 'lg' ? 18 : 16,
              lineHeight: multiline ? 24 : undefined,
              paddingVertical: multiline ? 12 : 0,
              minHeight: multiline ? 92 : 44,
              maxHeight: multiline ? 160 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
              outlineStyle: 'none',
            } as never,
            inputStyle,
          ]}
          {...rest}
        />
        {right}
      </View>
      {error || helper || counter ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
          {error ? (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={14} color={t.colors.dangerText} />
              <Text variant="footnote" color="dangerText" style={{ flex: 1 }} critical>
                {error}
              </Text>
            </View>
          ) : (
            <Text variant="footnote" color="muted" style={{ flex: 1 }} critical>
              {helper ?? ''}
            </Text>
          )}
          {counter ? (
            <Text variant="caption" color="muted" tabular critical>
              {counter}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/** Multiline input. The counter appears right-aligned once 80% of `maxLength` is used (Material pattern). */
export const TextArea = forwardRef<ComponentRef<typeof TextInput>, InputProps & { showCount?: boolean }>(function TextArea(
  { showCount = true, maxLength, value, ...rest },
  ref,
) {
  const len = (value ?? '').length;
  const counter = showCount && maxLength && len >= maxLength * 0.8 ? `${len}/${maxLength}` : undefined;
  return <Input ref={ref} multiline maxLength={maxLength} value={value} counter={counter} {...rest} />;
});
