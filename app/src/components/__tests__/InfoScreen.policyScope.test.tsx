import InfoDetailScreen from '../../features/identityScreens/InfoDetailScreen';
import { PROVIDER_TERMS_SUMMARY } from '../../lib/onboarding/copy';
import { requestAccountDeletion } from '../../lib/api';
import { supportContact } from '../../lib/config';
import { useAuth } from '../../lib/auth';
import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';
import { useConfirm, useToast } from '../ui';
import { useTheme } from '../../theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn() }));
jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn().mockResolvedValue(undefined) },
  View: 'View',
}));
jest.mock('../ui', () => ({
  Button: 'Button',
  Card: 'Card',
  Header: 'Header',
  Screen: 'Screen',
  Text: 'Text',
  useConfirm: jest.fn(),
  useToast: jest.fn(),
}));
jest.mock('../../lib/api', () => ({ requestAccountDeletion: jest.fn() }));
jest.mock('../../lib/config', () => ({
  supportContact: { email: 'help@example.test', phone: '+15550123456', whatsapp: '15550123456' },
}));
jest.mock('../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../theme', () => ({ useTheme: jest.fn() }));

const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;
const mockUseAuth = useAuth as unknown as jest.Mock;
const mockUseTheme = useTheme as unknown as jest.Mock;
const mockUseConfirm = useConfirm as unknown as jest.Mock;
const mockUseToast = useToast as unknown as jest.Mock;
const mockRequestAccountDeletion = requestAccountDeletion as jest.MockedFunction<typeof requestAccountDeletion>;
const mockOpenURL = Linking.openURL as jest.Mock;
const mockConfirm = jest.fn();
const mockToast = jest.fn();

function collectText(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (!node || typeof node !== 'object') return [];
  const props = (node as { props?: { title?: unknown; children?: unknown; header?: unknown } }).props;
  return [
    ...(typeof props?.title === 'string' ? [props.title] : []),
    ...collectText(props?.header),
    ...collectText(props?.children),
  ];
}

function collectButtons(node: unknown): { props: Record<string, any> }[] {
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  if (!node || typeof node !== 'object') return [];
  const element = node as { type?: unknown; props?: Record<string, any> };
  const props = element.props ?? {};
  return [
    ...(element.type === 'Button' ? [{ props }] : []),
    ...collectButtons(props.children),
  ];
}

function renderTopic(topic: string, session: unknown = null) {
  mockUseLocalSearchParams.mockReturnValue({ topic });
  mockUseAuth.mockReturnValue({ session });
  return InfoDetailScreen();
}

async function submitDeletion(topic: string, outcome: 'recorded' | 'email') {
  mockRequestAccountDeletion.mockResolvedValue(outcome);
  const tree = renderTopic(topic, { user: { id: 'guest' } });
  const button = collectButtons(tree).find(({ props }) => props.title === 'Request account deletion');
  expect(button).toBeDefined();
  button!.props.onPress();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return collectText(tree).join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTheme.mockReturnValue({
    spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
    radii: { sm: 8 },
    colors: { surfaceAlt: '#eee', textSecondary: '#666' },
  });
  mockUseConfirm.mockReturnValue(mockConfirm);
  mockUseToast.mockReturnValue(mockToast);
  mockConfirm.mockResolvedValue(true);
  mockRequestAccountDeletion.mockResolvedValue('recorded');
});

describe('Info screen policy scope', () => {
  it('distinguishes quote-required jobs from fixed and proposal work without universal workflow claims', () => {
    const text = collectText(renderTopic('safety')).join(' ');

    expect(text).not.toContain('Every booking on QuickServe is protected');
    expect(text).not.toContain('Code-protected visits');
    expect(text).toContain('For jobs that require an itemized quote');
    expect(text).toContain('Fixed-price and proposal work follows the accepted package or proposal');
    expect(text).toContain('24-hour');
  });

  it('qualifies the provider quote summary by workflow', () => {
    expect(PROVIDER_TERMS_SUMMARY[0]).toContain('For jobs that require an itemized quote');
    expect(PROVIDER_TERMS_SUMMARY[0]).toContain('Fixed-price and proposal work');
  });

  it('labels deletion as a request and explains pending processing before confirmation', () => {
    const text = collectText(renderTopic('privacy', { user: { id: 'guest' } })).join(' ');
    const button = collectButtons(renderTopic('privacy', { user: { id: 'guest' } }))
      .find(({ props }) => props.title === 'Request account deletion');

    expect(text).toContain('Request account deletion');
    expect(button).toBeDefined();
    button!.props.onPress();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Request account deletion?',
      message: expect.stringContaining('pending until processed'),
    }));
  });

  it('reports a recorded deletion request as pending without changing the existing confirmation window', async () => {
    await submitDeletion('privacy', 'recorded');

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Deletion request recorded; processing is pending.'),
    }));
    expect(mockToast.mock.calls[0][0].message).toContain('within 30 days');
  });

  it('does not imply an email fallback was stored before the user sends it', async () => {
    await submitDeletion('privacy', 'email');

    expect(mockToast.mock.calls[0][0].message).toContain('Send the message to submit your deletion request');
    expect(mockToast.mock.calls[0][0].message).not.toContain('Deletion request recorded');
  });

  it('keeps guest sign-in help and configured support actions available', () => {
    const tree = renderTopic('help');
    const buttons = collectButtons(tree);

    expect(collectText(tree).join(' ')).toContain('Sign-in help');
    expect(buttons.map(({ props }) => props.title)).toEqual([
      `Email ${supportContact.email}`,
      'Call support',
      'Message support on WhatsApp',
    ]);

    buttons.forEach(({ props }) => props.onPress());
    expect(mockOpenURL).toHaveBeenCalledWith(expect.stringContaining(supportContact.email));
    expect(mockOpenURL).toHaveBeenCalledWith(`tel:${supportContact.phone}`);
    expect(mockOpenURL).toHaveBeenCalledWith(`https://wa.me/${supportContact.whatsapp}`);
  });
});
