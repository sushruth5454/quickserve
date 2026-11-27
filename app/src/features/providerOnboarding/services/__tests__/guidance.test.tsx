import { PriceGuidanceCard, readPriceGuidance } from '../PricingStep';
import type { PriceGuidance } from '../../../../lib/onboarding';

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

function findElements(node: unknown, type: string): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap((item) => findElements(item, type));
  if (!node || typeof node !== 'object') return [];
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const matches = element.type === type ? [element as { props: Record<string, unknown> }] : [];
  return [...matches, ...findElements(element.props?.children, type)];
}

describe('optional price guidance', () => {
  beforeEach(() => {
    mockGetPriceGuidance = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      visit_fee: null,
      labour_rate: null,
      min_points: 3,
    });
  });

  it('shows Unavailable with Retry after failure, then remains nonblocking when retried', async () => {
    const unavailable = await readPriceGuidance('category-a', 'Pune', 'job');
    expect(unavailable).toEqual({ status: 'error', value: null });
    const retry = jest.fn();
    const card = PriceGuidanceCard({
      guidance: unavailable.value,
      city: 'Pune',
      hasCategory: true,
      status: unavailable.status,
      onRetry: retry,
    });
    expect(findElements(card, 'Text').map((element) => element.props.children)).toContain('Local price guidance is unavailable.');
    const retryButton = findElements(card, 'Button')[0];
    expect(retryButton?.props.title).toBe('Retry');
    (retryButton?.props.onPress as (() => void) | undefined)?.();
    expect(retry).toHaveBeenCalledTimes(1);

    const available = await readPriceGuidance('category-a', 'Pune', 'job');
    expect(mockGetPriceGuidance).toHaveBeenCalledTimes(2);
    expect(available.status).toBe('ready');
    expect((available.value as PriceGuidance).min_points).toBe(3);
    const readyCard = PriceGuidanceCard({
      guidance: available.value,
      city: 'Pune',
      hasCategory: true,
      status: available.status,
      onRetry: retry,
    });
    expect(findElements(readyCard, 'Text').map((element) => element.props.children).join(' ')).toContain('No local data yet for Pune.');
  });
});
