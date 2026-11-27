import React from 'react';
import { act, create } from 'react-test-renderer';
import { PricingStep } from '../PricingStep';

let mockGetPriceGuidance: jest.Mock;

jest.mock('react-native', () => ({ View: 'View' }));

jest.mock('../../../../components/ui', () => ({
  Button: 'Button',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  SegmentedControl: 'SegmentedControl',
  Text: 'Text',
}));

jest.mock('../../../../theme', () => ({
  useTheme: () => ({
    colors: { infoSoft: '#eef', infoText: '#225', textSecondary: '#444' },
    radii: { md: 8 },
    spacing: { lg: 16, md: 12, xs: 4 },
  }),
}));

jest.mock('../../../../lib/onboarding', () => ({
  onboardingApi: { getPriceGuidance: (...args: unknown[]) => mockGetPriceGuidance(...args) },
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('optional price guidance', () => {
  beforeEach(() => {
    mockGetPriceGuidance = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      visit_fee: null,
      labour_rate: null,
      min_points: 3,
    });
  });

  it('shows Unavailable with Retry after failure, then retries independently of the editor', async () => {
    const renderer = create(
      <PricingStep
        state={{ categoryId: 'category-a', unit: 'job' } as never}
        city="Pune"
        guidance={null}
        errors={{}}
        onState={() => undefined}
      />,
    );
    await act(async () => flushPromises());

    expect(JSON.stringify(renderer.toJSON())).toContain('Local price guidance is unavailable.');
    const retry = renderer.root.findByProps({ title: 'Retry' });
    await act(async () => {
      retry.props.onPress();
      await flushPromises();
    });
    expect(mockGetPriceGuidance).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('No local data yet for Pune.');
    renderer.unmount();
  });
});
