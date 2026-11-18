import type { Palette } from '../../theme/tokens';

export type Pillar = 'home' | 'shops' | 'sports' | 'creators';

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
