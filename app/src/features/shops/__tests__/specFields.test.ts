import { cleanSpecs } from '../SpecFields';

describe('schema-driven product specifications', () => {
  it('trims entered values and omits blank fields', () => {
    const actual = cleanSpecs({ size: ' 600x600 ', finish: '   ', material: ' porcelain ' });
    expect(JSON.stringify(actual)).toBe(JSON.stringify({ size: '600x600', material: 'porcelain' }));
  });
});
