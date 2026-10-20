/** Indicative "typical total" bands per category shown on the Book screen (rupees, incl. parts). */
export const TYPICAL_TOTAL_RUPEES: Record<string, [number, number]> = {
  'ac-repair': [600, 2800],
  electrician: [250, 1500],
  plumber: [250, 1800],
  'house-cleaning': [1200, 4500],
  'water-tank-cleaning': [600, 1800],
  'car-mechanic': [800, 6000],
  'bike-mechanic': [300, 2000],
  'appliance-repair': [400, 2500],
  'pest-control': [900, 3500],
  carpenter: [350, 3000],
  painter: [2500, 15000],
};

export function typicalRange(slug: string | undefined | null): [number, number] | null {
  if (!slug) return null;
  return TYPICAL_TOTAL_RUPEES[slug] ?? null;
}
