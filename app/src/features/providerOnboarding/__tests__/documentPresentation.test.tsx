import { documentRows, documentStatusLabel, requirementPresentation } from '../PortfolioSection';
import type { OnboardingData } from '../useOnboardingData';
import type { DocumentRequirement, ProviderDocument } from '../../../lib/onboarding';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('../../../components/ui', () => ({
  Badge: 'Badge',
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  ListItem: 'ListItem',
  Screen: 'Screen',
  Text: 'Text',
  useConfirm: () => jest.fn(),
  useToast: () => jest.fn(),
}));
jest.mock('../../../lib/onboarding', () => ({ onboardingApi: {} }));
jest.mock('../media', () => ({ pickDocument: jest.fn(), pickPhoto: jest.fn() }));
jest.mock('../parts', () => ({
  FieldLabel: 'FieldLabel',
  Intro: 'Intro',
  SectionFooter: 'SectionFooter',
  istToday: () => '2026-11-27',
}));
jest.mock('../../../theme', () => ({ useTheme: () => ({ colors: {}, spacing: {}, radii: {} }) }));

const requirement = (overrides: Partial<DocumentRequirement> = {}): DocumentRequirement => ({
  doc_type: 'license',
  category_id: 'category-a',
  category_name: 'Electrical',
  satisfied: false,
  approved_document_id: null,
  approved_status: null,
  latest_document_id: null,
  latest_status: null,
  effective_latest_status: null,
  expires_on: null,
  reject_reason: null,
  ...overrides,
});

const document = (id: string, status: ProviderDocument['status'], categoryId: string | null = 'category-a'): ProviderDocument => ({
  id,
  doc_type: 'license',
  category_id: categoryId,
  status,
  reject_reason: null,
  expires_on: null,
  created_at: id,
});

function dataFor(requirements: DocumentRequirement[], documents: ProviderDocument[]): OnboardingData {
  return {
    state: {
      provider: null,
      profile: null,
      payout: null,
      documents,
      document_requirements: requirements,
      server_local_date: '2026-11-27',
      availability: [],
      time_off: [],
      portfolio: [],
      checks: [],
      go_live: { state: 'draft', reasons: [], paused: false },
      terms_version: 'v1',
    },
    categories: [
      { id: 'category-a', name: 'Electrical', requires_docs: ['license'] } as never,
      { id: 'category-b', name: 'Plumbing', requires_docs: ['license'] } as never,
    ],
    services: [
      { id: 'service-a', category_id: 'category-a', active: true } as never,
      { id: 'service-b', category_id: 'category-b', active: true } as never,
    ],
    skills: [],
    docTypes: [{ code: 'license', label: 'Trade license', description: '', has_expiry: true, sort_order: 1 }],
  };
}

describe('owner document presentation', () => {
  it('keeps required credentials scoped to each service category', () => {
    const categoryA = requirement({
      category_id: 'category-a',
      category_name: 'Electrical',
      latest_document_id: 'latest-a',
      latest_status: 'pending',
      effective_latest_status: 'pending',
    });
    const categoryB = requirement({
      category_id: 'category-b',
      category_name: 'Plumbing',
      latest_document_id: 'latest-b',
      latest_status: 'rejected',
      effective_latest_status: 'rejected',
    });
    const rows = documentRows(dataFor([categoryA, categoryB], [document('latest-a', 'pending'), document('latest-b', 'rejected', 'category-b')]));
    expect(rows.map((row) => [row.categoryName, row.latest?.id])).toEqual([
      ['Electrical', 'latest-a'],
      ['Plumbing', 'latest-b'],
    ]);
  });

  it('does not reuse a category-specific legacy document for another category', () => {
    const rows = documentRows(dataFor([], [document('category-a-only', 'approved')]));
    expect(rows.map((row) => [row.categoryName, row.latest?.id ?? null])).toEqual([
      ['Electrical', 'category-a-only'],
      ['Plumbing', null],
    ]);
  });

  it('keeps an approved fallback credential distinct from a newer pending submission', () => {
    const rows = documentRows(dataFor([], [
      document('approved-old', 'approved'),
      document('pending-new', 'pending'),
    ]));
    expect(rows[0]?.latest?.id).toBe('pending-new');
    expect(rows[0]?.validCredential?.id).toBe('approved-old');
  });

  it('shows a latest replacement submission separately from a still-valid approved credential', () => {
    const replacement = requirement({
      satisfied: true,
      approved_document_id: 'approved-old',
      approved_status: 'approved',
      latest_document_id: 'pending-new',
      latest_status: 'pending',
      effective_latest_status: 'pending',
    });
    expect(requirementPresentation(replacement)).toEqual({
      latestStatus: 'pending',
      validCredential: true,
      separateValidCredential: true,
    });
  });

  it('uses the server effective expiry status instead of calling an expired credential approved', () => {
    const expired = requirement({
      latest_document_id: 'expired-latest',
      latest_status: 'approved',
      effective_latest_status: 'expired',
      expires_on: '2026-11-26',
    });
    expect(requirementPresentation(expired).latestStatus).toBe('expired');
    expect(requirementPresentation(expired).validCredential).toBe(false);
    expect(documentStatusLabel('expired')).toBe('Expired');
  });

  it('labels approved credentials Approved, never Live', () => {
    const approved = requirement({
      satisfied: true,
      approved_document_id: 'approved-latest',
      approved_status: 'approved',
      latest_document_id: 'approved-latest',
      latest_status: 'approved',
      effective_latest_status: 'approved',
    });
    expect(requirementPresentation(approved).latestStatus).toBe('approved');
    expect(documentStatusLabel('approved')).toBe('Approved');
  });
});
