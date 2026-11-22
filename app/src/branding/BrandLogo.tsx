import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useBrandIdentity } from './useBrandIdentity';
import type { BrandContext } from './identity';

export interface BrandLogoProps {
  context: BrandContext;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function BrandLogo({ context, style, testID }: BrandLogoProps) {
  const { displayName } = useBrandIdentity(context);

  // Uploaded asset identifiers are not image URIs; O05B owns the approved asset binding.
  return (
    <Text
      accessible
      accessibilityLabel={displayName}
      style={style}
      testID={testID}
    >
      {displayName}
    </Text>
  );
}
