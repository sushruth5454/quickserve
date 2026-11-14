import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Badge, Button, Card, Text } from '../../components/ui';
import type { DocumentType, GoLive, GoLiveState } from '../../lib/onboarding';
import { GO_LIVE_BODY, GO_LIVE_TITLE, reasonCopy, type ReasonCopy } from '../../lib/onboarding/copy';
import { useTheme } from '../../theme';

const TONE: Record<GoLiveState, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'info',
  under_review: 'warning',
  action_needed: 'danger',
  live: 'success',
  suspended: 'danger',
  deactivated: 'neutral',
};

const ICON: Record<GoLiveState, 'create-outline' | 'time-outline' | 'alert-circle-outline' | 'checkmark-circle' | 'ban-outline' | 'pause-circle-outline'> = {
  draft: 'create-outline',
  under_review: 'time-outline',
  action_needed: 'alert-circle-outline',
  live: 'checkmark-circle',
  suspended: 'ban-outline',
  deactivated: 'pause-circle-outline',
};

/**
 * Provider go-live status (Draft / Under review / Action needed / Live …) with the reasons from _provider_go_live().
 * Used on the provider dashboard (until live) and the provider profile hub.
 */
export function GoLiveStatusCard({
  goLive,
  docTypes,
  onFix,
  onContinue,
  compact,
}: {
  goLive: GoLive;
  docTypes: DocumentType[];
  onFix?: (section: NonNullable<ReasonCopy['section']>) => void;
  onContinue?: () => void;
  compact?: boolean;
}) {
  const t = useTheme();
  const tone = TONE[goLive.state];
  const reasons = goLive.reasons.map((r) => ({ r, c: reasonCopy(r, docTypes.find((d) => d.code === r.doc_type)?.label) }));
  const fg = tone === 'success' ? t.colors.successText : tone === 'danger' ? t.colors.dangerText : tone === 'warning' ? t.colors.warningText : tone === 'info' ? t.colors.infoText : t.colors.textSecondary;
  return (
    <Card gap={t.spacing.md} accessibilityLabel={`Provider status: ${GO_LIVE_TITLE[goLive.state]}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Ionicons name={ICON[goLive.state]} size={26} color={fg} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title3">{GO_LIVE_TITLE[goLive.state]}</Text>
          {!compact || goLive.state !== 'live' ? (
            <Text variant="footnote" color="muted">
              {GO_LIVE_BODY[goLive.state]}
            </Text>
          ) : null}
        </View>
        {goLive.paused && goLive.state === 'live' ? <Badge label="Holiday mode" tone="warning" /> : null}
      </View>
      {reasons.map(({ r, c }, i) => (
        <View key={`${r.code}-${i}`} style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
          <Ionicons name={r.severity === 'action' ? 'alert-circle' : 'time'} size={16} color={r.severity === 'action' ? t.colors.dangerText : t.colors.warningText} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheadStrong">{c.title}</Text>
            <Text variant="footnote" color="textSecondary">
              {c.body}
            </Text>
          </View>
          {c.section && onFix ? <Button title="Fix" size="sm" variant="outline" onPress={() => onFix(c.section!)} /> : null}
        </View>
      ))}
      {goLive.state === 'draft' && onContinue ? <Button title="Continue setup" rightIcon="arrow-forward" onPress={onContinue} /> : null}
    </Card>
  );
}
