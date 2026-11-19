import { validateSchema, validateValues } from './schema';

const reelMakerSchema = {
  type: 'object',
  properties: {
    count: { type: 'integer', minimum: 1, maximum: 100 },
    length_seconds: { type: 'integer', enum: [15, 30, 60, 90] },
    aspect_ratio: { type: 'string', enum: ['9:16', '1:1', '16:9'] },
    captions: { type: 'boolean' },
    music: { type: 'string', enum: ['provider-licensed', 'customer-supplied', 'none'] },
    footage_handover: { type: 'string', enum: ['drive-link', 'in-person', 'creator-shoots'] },
    reference_links: { type: 'string' },
  },
  required: ['count', 'aspect_ratio'],
};

describe('reel-maker structured brief schema', () => {
  it('accepts a valid count, length, and aspect ratio', () => {
    const value = { count: 10, length_seconds: 30, aspect_ratio: '9:16' };
    expect(validateSchema(reelMakerSchema)).toEqual([]);
    expect(validateValues(reelMakerSchema, value)).toEqual([]);
  });

  it('rejects invalid counts and missing required fields', () => {
    const issues = validateValues(reelMakerSchema, { count: 101, length_seconds: 30 });
    expect(issues).toEqual(expect.arrayContaining([
      { path: 'count', message: 'Maximum is 100' },
      { path: 'aspect_ratio', message: 'Required' },
    ]));
  });
});
