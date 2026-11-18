import { getAdminFeaturePresentation, isAdminRulesEditorEnabled } from '../adminFeaturePresentation';
import type { AdminFeature } from '../adminApi';

const feature = (key: string, label: string): AdminFeature => ({
  key,
  enabled: false,
  label,
  description: '',
  group_name: 'Recurring',
  sort_order: 0,
  updated_at: '',
});

describe('admin feature presentation (H1-SC-01, H1-SC-04)', () => {
  it('shows the rules editor only when admin_rules_editor is explicitly on (H1-SC-01)', () => {
    expect(isAdminRulesEditorEnabled((key) => key === 'admin_rules_editor')).toBe(true);
    expect(isAdminRulesEditorEnabled(() => false)).toBe(false);
  });

  it('indents and disables children with a clear parent-off explanation (H1-SC-04)', () => {
    const rows = [
      feature('recurring_bookings', 'Recurring bookings'),
      feature('recurring_skip_pause', 'Skip and pause visits'),
    ];
    const presentation = getAdminFeaturePresentation(rows[1]!, rows, { recurring_bookings: false, recurring_skip_pause: true });

    expect(presentation).toEqual({
      parentKey: 'recurring_bookings',
      parentLabel: 'Recurring bookings',
      indentLevel: 1,
      disabledByParent: true,
      explanation: 'Enable Recurring bookings first; this child switch cannot take effect while its parent is off.',
    });
  });

  it('keeps children interactive only after their parent is enabled (H1-SC-04)', () => {
    const rows = [
      feature('sports', 'Sports & venues'),
      feature('sports_online_payments', 'Sports online payments'),
    ];
    const presentation = getAdminFeaturePresentation(rows[1]!, rows, { sports: true, sports_online_payments: false });

    expect(presentation.disabledByParent).toBe(false);
    expect(presentation.explanation).toBeNull();
    expect(presentation.parentLabel).toBe('Sports & venues');
  });
});
