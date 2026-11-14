import { formatINR } from '../lib/money';
import { Text, type TextColor } from './ui/Text';

/** Large amount with the paise de-emphasised: "₹1,036" + ".52". Exact paise stay visible in breakdowns. */
export function HeroAmount({ paise, color = 'text', light }: { paise: number; color?: TextColor; light?: boolean }) {
  const s = formatINR(paise);
  const dot = s.lastIndexOf('.');
  const main = dot < 0 ? s : s.slice(0, dot);
  const frac = dot < 0 ? '' : s.slice(dot);
  const style = light ? { color: '#FFFFFF' } : undefined;
  return (
    <Text variant="display" color={color} tabular style={style} accessibilityLabel={s}>
      {main}
      {frac ? (
        <Text variant="title3" color={color} tabular style={[style, { opacity: 0.75 }]}>
          {frac}
        </Text>
      ) : null}
    </Text>
  );
}
