import { contrastRatio } from '../theme/contrast';

/** A.1's exact remote hex overrides; the alpha overlay remains derived in code. */
export const COLOR_OVERRIDE_KEYS = [
  'primary',
  'primaryPressed',
  'primarySoft',
  'primaryText',
  'onPrimary',
  'secondary',
  'accent',
  'onAccent',
  'success',
  'successStrong',
  'successSoft',
  'successText',
  'warning',
  'warningSoft',
  'warningText',
  'danger',
  'dangerStrong',
  'dangerPressed',
  'onDanger',
  'dangerSoft',
  'dangerText',
  'info',
  'infoSoft',
  'infoText',
  'text',
  'textSecondary',
  'muted',
  'subtle',
  'bg',
  'surface',
  'surfaceAlt',
  'surfaceRaised',
  'surfaceOverlay',
  'border',
  'borderStrong',
  'outline',
  'star',
  'skeleton',
  'bubbleMine',
  'bubbleTheirs',
  'heroFrom',
  'heroTo',
  'onHero',
  'onInverse',
  'toastBg',
  'toastBorder',
  'segmentThumb',
  'catHome',
  'catHomeSoft',
  'catHomeText',
  'catShops',
  'catShopsSoft',
  'catShopsText',
  'catSports',
  'catSportsSoft',
  'catSportsText',
  'catCreators',
  'catCreatorsSoft',
  'catCreatorsText',
] as const;

export type ColorOverrideKey = (typeof COLOR_OVERRIDE_KEYS)[number];

export interface ContrastPair {
  foreground: string;
  background: string;
  purpose: string;
}

export const ACTUAL_USE_COLOR_PAIRS: readonly ContrastPair[] = [
  { foreground: 'text', background: 'bg', purpose: 'body text on page' },
  { foreground: 'text', background: 'surface', purpose: 'body text on surface' },
  { foreground: 'text', background: 'surfaceAlt', purpose: 'body text on alternate surface' },
  { foreground: 'text', background: 'surfaceRaised', purpose: 'body text on raised surface' },
  { foreground: 'text', background: 'surfaceOverlay', purpose: 'body text on overlay surface' },
  { foreground: 'text', background: 'segmentThumb', purpose: 'selected segment label' },
  { foreground: 'text', background: 'bubbleTheirs', purpose: 'received message text' },
  { foreground: 'textSecondary', background: 'bg', purpose: 'supporting text on page' },
  { foreground: 'textSecondary', background: 'surface', purpose: 'supporting text on surface' },
  { foreground: 'textSecondary', background: 'borderStrong', purpose: 'unselected count label' },
  { foreground: 'muted', background: 'bg', purpose: 'muted text on page' },
  { foreground: 'muted', background: 'surface', purpose: 'muted text on surface' },
  { foreground: 'muted', background: 'surfaceAlt', purpose: 'muted text on alternate surface' },
  { foreground: 'primaryText', background: 'bg', purpose: 'primary link on page' },
  { foreground: 'primaryText', background: 'surface', purpose: 'primary link on surface' },
  { foreground: 'primaryText', background: 'primarySoft', purpose: 'selected label on primary soft' },
  { foreground: 'onPrimary', background: 'primary', purpose: 'primary action, selected counts, assistant send/mic' },
  { foreground: 'onPrimary', background: 'primaryPressed', purpose: 'pressed primary action and assistant send/mic' },
  { foreground: 'onPrimary', background: 'bubbleMine', purpose: 'sent message text' },
  { foreground: 'successText', background: 'successSoft', purpose: 'success status text' },
  { foreground: 'warningText', background: 'warningSoft', purpose: 'warning status text' },
  { foreground: 'dangerText', background: 'dangerSoft', purpose: 'danger status text' },
  { foreground: 'infoText', background: 'infoSoft', purpose: 'information status text' },
  { foreground: 'onDanger', background: 'dangerStrong', purpose: 'destructive default and unread numeric' },
  { foreground: 'onDanger', background: 'dangerPressed', purpose: 'destructive pressed' },
  { foreground: 'onAccent', background: 'accent', purpose: 'accent text' },
  { foreground: 'onHero', background: 'heroFrom', purpose: 'hero text on leading fill' },
  { foreground: 'onHero', background: 'heroTo', purpose: 'hero text on trailing fill' },
  { foreground: 'onInverse', background: 'toastBg', purpose: 'toast text' },
  { foreground: 'catHomeText', background: 'catHomeSoft', purpose: 'home category text' },
  { foreground: 'catShopsText', background: 'catShopsSoft', purpose: 'shops category text' },
  { foreground: 'catSportsText', background: 'catSportsSoft', purpose: 'sports category text' },
  { foreground: 'catCreatorsText', background: 'catCreatorsSoft', purpose: 'creators category text' },
];

export function getContrastFailures(colors: object): string[] {
  const values = colors as Record<string, unknown>;
  const failures: string[] = [];

  for (const pair of ACTUAL_USE_COLOR_PAIRS) {
    const foreground = values[pair.foreground];
    const background = values[pair.background];
    if (typeof foreground !== 'string' || typeof background !== 'string') continue;

    try {
      const ratio = contrastRatio(foreground, background);
      if (ratio < 4.5) {
        failures.push(
          `${pair.foreground}/${pair.background} for ${pair.purpose} is ${ratio.toFixed(2)}:1; minimum is 4.5:1`,
        );
      }
    } catch {
      failures.push(`${pair.foreground}/${pair.background} for ${pair.purpose} is not valid hex color data`);
    }
  }

  return failures;
}
