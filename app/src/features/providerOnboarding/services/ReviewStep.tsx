import { View } from 'react-native';
import { Card, Text } from '../../../components/ui';
import type { CategorySkill, ProfileSchema } from '../../../lib/onboarding';
import { SKILL_LEVEL_INFO } from '../../../lib/onboarding/copy';
import { formatINR } from '../../../lib/money';
import { parseRupees } from '../../../lib/onboarding/validation';
import type { EditableService, ServiceEditorState } from '../serviceEditor';
import { serviceExpertiseLabels } from '../serviceEditor';
import { useTheme } from '../../../theme';

export function ReviewStep({ state, categoryName, skills, schema, packageCount }: {
  state: ServiceEditorState;
  categoryName: string;
  skills: CategorySkill[];
  schema: ProfileSchema;
  packageCount: number;
}) {
  const t = useTheme();
  const expertise = serviceExpertiseLabels(
    { category_id: state.categoryId ?? '', specialisations: state.specialisations, attributes: state.attributes } as unknown as EditableService,
    skills,
    schema,
  );
  const travel = state.travelFeeMode === 'none'
    ? 'Normal service area only'
    : `${state.maxTravel} km, ${state.travelFeeMode === 'flat' ? `${formatINR(parseRupees(state.travelFlat) ?? 0)} flat` : `${formatINR(parseRupees(state.travelPerKm) ?? 0)}/km`}`;
  return (
    <Card gap={t.spacing.md} style={{ borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft }} accessibilityLabel="Service summary">
      <Text variant="title3" color="primaryText">{categoryName}</Text>
      <SummaryRow label="Experience" value={SKILL_LEVEL_INFO[state.level].title} />
      <SummaryRow label="Expertise" value={expertise.length ? expertise.join(' · ') : 'Add exact expertise'} />
      {state.brands.length ? <SummaryRow label="Brands" value={state.brands.join(' · ')} /> : null}
      {state.tools.length ? <SummaryRow label="Tools" value={state.tools.join(' · ')} /> : null}
      <SummaryRow label="Pricing" value={`${formatINR(parseRupees(state.visitFee) ?? 0)} visit · ${formatINR(parseRupees(state.labour) ?? 0)}/${state.unit}`} />
      <SummaryRow label="Coverage" value={travel} />
      <SummaryRow label="Packages" value={packageCount ? `${packageCount} package${packageCount === 1 ? '' : 's'} saved` : 'Can be added after saving'} />
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
      <Text variant="footnoteStrong" color="muted" style={{ width: 82 }}>{label}</Text>
      <Text variant="callout" style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}
