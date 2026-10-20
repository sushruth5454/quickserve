import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

export function Divider({ inset = 0, dashed, style }: { inset?: number; dashed?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        dashed
          ? { borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.colors.borderStrong }
          : { height: StyleSheetHairline, backgroundColor: t.colors.border },
        { marginLeft: inset },
        style,
      ]}
    />
  );
}

const StyleSheetHairline = 1;
