function linearizeChannel(hexChannel: string): number {
  const channel = Number.parseInt(hexChannel, 16) / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new RangeError('Color must be a 6-digit hexadecimal value');
  }

  return (
    0.2126 * linearizeChannel(hex.slice(0, 2)) +
    0.7152 * linearizeChannel(hex.slice(2, 4)) +
    0.0722 * linearizeChannel(hex.slice(4, 6))
  );
}

export function contrastRatio(fg: string, bg: string): number {
  const foregroundLuminance = relativeLuminance(fg);
  const backgroundLuminance = relativeLuminance(bg);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}
