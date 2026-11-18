import { darkPalette, lightPalette } from '../tokens';
import { contrastRatio } from '../contrast';

describe('WCAG palette contrast', () => {
  test('matches the contrast ratios documented for the design tokens', () => {
    const documentedPairs: Array<[string, string, string, number]> = [
      ['white on light primary', lightPalette.onPrimary, lightPalette.primary, 6.78],
      ['white on light primaryPressed', lightPalette.onPrimary, lightPalette.primaryPressed, 8.91],
      ['light primary on primarySoft', lightPalette.primary, lightPalette.primarySoft, 6.06],
      ['light primaryText on bg', lightPalette.primaryText, lightPalette.bg, 6.33],
      ['white on light bubbleMine', lightPalette.onPrimary, lightPalette.bubbleMine, 6.78],
      ['white on dark primary', darkPalette.onPrimary, darkPalette.primary, 5.21],
      ['dark primaryText on surface', darkPalette.primaryText, darkPalette.surface, 6.86],
      ['light catHome on catHomeSoft', lightPalette.catHome, lightPalette.catHomeSoft, 4.84],
      ['light catShops on catShopsSoft', lightPalette.catShops, lightPalette.catShopsSoft, 4.58],
      ['light catSports on catSportsSoft', lightPalette.catSports, lightPalette.catSportsSoft, 5.13],
      ['light catCreators on catCreatorsSoft', lightPalette.catCreators, lightPalette.catCreatorsSoft, 6.11],
      ['dark catHome on catHomeSoft', darkPalette.catHome, darkPalette.catHomeSoft, 10.33],
      ['dark catShops on catShopsSoft', darkPalette.catShops, darkPalette.catShopsSoft, 10.8],
      ['dark catSports on catSportsSoft', darkPalette.catSports, darkPalette.catSportsSoft, 9.38],
      ['dark catCreators on catCreatorsSoft', darkPalette.catCreators, darkPalette.catCreatorsSoft, 9.03],
    ];

    for (const [label, foreground, background, expected] of documentedPairs) {
      expect(Math.abs(contrastRatio(foreground, background) - expected))
        .toBeLessThanOrEqual(0.02);
    }
  });

  test('text colors meet AA contrast on backgrounds and surfaces in both palettes', () => {
    for (const palette of [lightPalette, darkPalette]) {
      for (const foreground of [palette.text, palette.textSecondary, palette.muted]) {
        for (const background of [palette.bg, palette.surface]) {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test('onPrimary meets AA contrast on primary in both palettes', () => {
    for (const palette of [lightPalette, darkPalette]) {
      expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('every category accent meets AA contrast on its soft background', () => {
    const pairs: Array<[string, string]> = [
      [lightPalette.catHome, lightPalette.catHomeSoft],
      [lightPalette.catShops, lightPalette.catShopsSoft],
      [lightPalette.catSports, lightPalette.catSportsSoft],
      [lightPalette.catCreators, lightPalette.catCreatorsSoft],
      [darkPalette.catHome, darkPalette.catHomeSoft],
      [darkPalette.catShops, darkPalette.catShopsSoft],
      [darkPalette.catSports, darkPalette.catSportsSoft],
      [darkPalette.catCreators, darkPalette.catCreatorsSoft],
    ];

    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
