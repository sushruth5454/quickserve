import { Image } from 'expo-image';
import {
  Text,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useBrandIdentity } from './useBrandIdentity';
import type { BrandContext, ResolvedBrandIdentity } from './identity';

export interface BrandLogoProps {
  context: BrandContext;
  identity?: ResolvedBrandIdentity;
  variant?: 'full' | 'compact';
  colorScheme?: 'light' | 'dark';
  style?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  testID?: string;
}

export function BrandLogo({
  context,
  identity,
  variant = 'full',
  colorScheme = 'light',
  style,
  imageStyle,
  testID,
}: BrandLogoProps) {
  const resolvedIdentity = useBrandIdentity(context);
  const selectedIdentity = identity ?? resolvedIdentity;
  const assetKey = variant === 'compact'
    ? colorScheme === 'dark' ? 'compactDark' : 'compactLight'
    : colorScheme === 'dark' ? 'logoDark' : 'logoLight';
  const selectedAsset =
    selectedIdentity.source === 'bundled'
      ? selectedIdentity[assetKey]
      : null;

  if (selectedAsset !== null && selectedAsset !== undefined) {
    return (
      <Image
        accessible
        accessibilityLabel={selectedIdentity.displayName}
        contentFit="contain"
        source={selectedAsset}
        style={imageStyle ?? {
          width: variant === 'compact' ? 40 : 180,
          height: variant === 'compact' ? 40 : 50,
        }}
        testID={testID}
      />
    );
  }

  return (
    <Text
      accessible
      accessibilityLabel={selectedIdentity.displayName}
      style={style}
      testID={testID}
    >
      {selectedIdentity.displayName}
    </Text>
  );
}
