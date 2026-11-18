import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, TextInput, View, type TextStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';

export interface SearchFieldProps {
  mode: 'entry' | 'input';
  value?: string;
  onChangeText?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onPress?: () => void;
  placeholder: string;
  autoFocus?: boolean;
  testID?: string;
}

export function SearchField({
  mode,
  value,
  onChangeText,
  onSubmit,
  onPress,
  placeholder,
  autoFocus,
  testID,
}: SearchFieldProps) {
  const t = useTheme();
  const fieldStyle = {
    height: 48,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radii.md,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surface,
    ...t.shadows.sm,
  };
  const webInputStyle: TextStyle | undefined =
    Platform.OS === 'web' ? { outlineStyle: 'none' } : undefined;

  if (mode === 'entry') {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        onPress={onPress}
        style={({ pressed }) => [fieldStyle, pressed ? { opacity: 0.85 } : undefined]}
      >
        <Ionicons name="search" size={t.iconSize.md} color={t.colors.muted} />
        <Text variant="body" color="muted" numberOfLines={1} style={{ flex: 1 }}>
          {placeholder}
        </Text>
      </Pressable>
    );
  }

  const query = value ?? '';

  return (
    <View style={fieldStyle}>
      <Ionicons name="search" size={t.iconSize.md} color={t.colors.muted} />
      <TextInput
        testID={testID}
        accessibilityLabel={placeholder}
        value={query}
        onChangeText={onChangeText}
        onSubmitEditing={(event) => onSubmit?.(event.nativeEvent.text)}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        autoFocus={autoFocus}
        style={[t.typography.body, { flex: 1, color: t.colors.text, paddingVertical: 0 }, webInputStyle]}
      />
      {query.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText?.('')}
          hitSlop={4}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close-circle" size={t.iconSize.md} color={t.colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
