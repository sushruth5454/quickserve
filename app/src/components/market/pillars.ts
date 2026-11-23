import type { Palette } from '../../theme/tokens';
import type { CardPresentation } from './listingModel';

export type Pillar = 'home' | 'shops' | 'sports' | 'creators';

const PILLAR_GRID_HORIZONTAL_GUTTER = 32;
const PILLAR_GRID_MIN_CONTENT_WIDTH = 288;
const PILLAR_GRID_MAX_FONT_SCALE = 1.3;

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

  const contentWidth = viewportWidth - PILLAR_GRID_HORIZONTAL_GUTTER;
  const twoColumns = contentWidth >= PILLAR_GRID_MIN_CONTENT_WIDTH && fontScale <= PILLAR_GRID_MAX_FONT_SCALE;
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
