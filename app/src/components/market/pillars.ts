import type { Palette } from '../../theme/tokens';
import type { CardPresentation } from './listingModel';

export type Pillar = 'home' | 'shops' | 'sports' | 'creators';

export function pillarCardLayout({
  presentation,
  viewportWidth,
  fontScale,
  fullWidth,
}: {
  presentation: CardPresentation;
  viewportWidth: number;
  fontScale: number;
  fullWidth: boolean;
}): { width: '48%' | '100%'; stacked: boolean } {
  if (presentation === 'legacy') {
    return {
      width: fullWidth ? '100%' : '48%',
      stacked: viewportWidth < 600,
    };
  }

  const twoColumns = viewportWidth - 32 >= 288 && fontScale <= 1.3;
  return {
    width: twoColumns ? '48%' : '100%',
    stacked: twoColumns,
  };
}

export const PILLAR_ORDER: Pillar[] = ['home', 'shops', 'sports', 'creators'];

export function visiblePillars(input: {
  hasHome: boolean;
  hasCreators: boolean;
  productsOn: boolean;
  sportsOn: boolean;
}): Pillar[] {
  const isVisible: Record<Pillar, boolean> = {
    home: input.hasHome,
    shops: input.productsOn,
    sports: input.sportsOn,
    creators: input.hasCreators,
  };

  return PILLAR_ORDER.filter((pillar) => isVisible[pillar]);
}

export function pillarAccent(pillar: Pillar, colors: Palette): { fg: string; soft: string } {
  switch (pillar) {
    case 'home':
      return { fg: colors.catHome, soft: colors.catHomeSoft };
    case 'shops':
      return { fg: colors.catShops, soft: colors.catShopsSoft };
    case 'sports':
      return { fg: colors.catSports, soft: colors.catSportsSoft };
    case 'creators':
      return { fg: colors.catCreators, soft: colors.catCreatorsSoft };
  }
}
