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

  it('keeps an enabled child switch interactive so an admin can turn it off while its parent is off (H1-SC-04)', () => {
    const rows = [
      feature('recurring_bookings', 'Recurring bookings'),
      feature('recurring_skip_pause', 'Skip and pause visits'),
    ];
    const presentation = getAdminFeaturePresentation(rows[1]!, rows, { recurring_bookings: false, recurring_skip_pause: true });

    expect(presentation.disabledByParent).toBe(true);
    expect(presentation.switchDisabledByParent).toBe(false);
    expect(presentation.explanation).toBe(
      'You can turn this child off while Recurring bookings is off; enable it first to turn the child back on.',
    );
  });

  it('prevents turning an off child on while its parent is off and explains how to enable it (H1-SC-04)', () => {
    const rows = [
      feature('recurring_bookings', 'Recurring bookings'),
      feature('recurring_skip_pause', 'Skip and pause visits'),
    ];
    const presentation = getAdminFeaturePresentation(rows[1]!, rows, { recurring_bookings: false, recurring_skip_pause: false });

    expect(presentation.disabledByParent).toBe(true);
    expect(presentation.switchDisabledByParent).toBe(true);
    expect(presentation.explanation).toBe('Enable Recurring bookings first; this child switch cannot be turned on while its parent is off.');
  });

  it('keeps children interactive only after their parent is enabled (H1-SC-04)', () => {
    const rows = [
      feature('sports', 'Sports & venues'),
      feature('sports_online_payments', 'Sports online payments'),
    ];
    const presentation = getAdminFeaturePresentation(rows[1]!, rows, { sports: true, sports_online_payments: false });

    expect(presentation.disabledByParent).toBe(false);
    expect(presentation.switchDisabledByParent).toBe(false);
    expect(presentation.explanation).toBeNull();
    expect(presentation.parentLabel).toBe('Sports & venues');
  });

  it('uses the shared parent map to explain a disabled intermediate ancestor', () => {
    const rows = [
      feature('oorva_brand', 'Oorva brand & colours'),
      feature('branding_runtime', 'Published appearance'),
      { ...feature('branding_editor', 'Branding editor'), enabled: true },
    ];
    const rawStates = { oorva_brand: false, branding_runtime: true, branding_editor: true };
    const presentation = getAdminFeaturePresentation(rows[2]!, rows, rawStates);

    expect(rows[2]!.enabled).toBe(true);
    expect(rawStates.branding_runtime).toBe(true);
    expect(rawStates.branding_editor).toBe(true);
    expect(presentation.parentKey).toBe('branding_runtime');
    expect(presentation.parentLabel).toBe('Published appearance');
    expect(presentation.disabledByParent).toBe(true);
    expect(presentation.switchDisabledByParent).toBe(false);
    expect(presentation.explanation).toBe(
      'You can turn this child off while Oorva brand & colours is off; enable it first to turn the child back on.',
    );
  });

  it('prevents enabling an OFF child when an earlier ancestor is OFF', () => {
    const rows = [
      feature('oorva_brand', 'Oorva brand & colours'),
      feature('branding_runtime', 'Published appearance'),
      feature('branding_editor', 'Branding editor'),
    ];
    const presentation = getAdminFeaturePresentation(rows[2]!, rows, {
      oorva_brand: false,
      branding_runtime: true,
      branding_editor: false,
    });

    expect(presentation.disabledByParent).toBe(true);
    expect(presentation.switchDisabledByParent).toBe(true);
    expect(presentation.explanation).toBe(
      'Enable Oorva brand & colours first; this child switch cannot be turned on while its parent is off.',
    );
  });
});
