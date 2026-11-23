import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { maxFontScale, useTheme, type Palette, type TypographyVariant } from '../../theme';

export type TextColor = keyof Palette;

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: TextColor;
  critical?: boolean;
  align?: TextStyle['textAlign'];
  uppercase?: boolean;
  tabular?: boolean;
}

/** Themed text. Font scaling is allowed but capped so layouts stay intact at the largest accessibility sizes. */
export function Text({
  variant = 'body',
  color = 'text',
  critical = false,
  align,
  uppercase,
  tabular,
  style,
  maxFontSizeMultiplier,
  ...rest
}: TextProps) {
  const t = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (critical ? 2 : maxFontScale[variant])}
      style={[
        t.typography[variant],
        { color: t.colors[color] },
        align ? { textAlign: align } : null,
        uppercase ? { textTransform: 'uppercase' } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...rest}
    />
  );
}
