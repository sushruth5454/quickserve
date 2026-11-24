import { View } from 'react-native';
import { Button, Card, Input, Text } from '../../components/ui';
import type { BrandingVersion } from './model';

export function BrandingHistory({
  versions,
  reason,
  canRecover,
  busy,
  onReasonChange,
  onRecover,
}: {
  versions: BrandingVersion[];
  reason: string;
  canRecover: boolean;
  busy: boolean;
  onReasonChange: (reason: string) => void;
  onRecover: (version: BrandingVersion) => void;
}) {
  return (
    <Card>
      <Text variant="title3">Published history & recovery</Text>
      <Text variant="footnote" color="muted">
        History and recovery remain available when the brand, runtime or editor is off. Recovery writes an audited rollback using the latest generation you reviewed.
      </Text>
      <Input
        label="Recovery reason"
        value={reason}
        maxLength={500}
        editable={canRecover && !busy}
        onChangeText={onReasonChange}
        helper="Required for an audited rollback (1–500 characters)."
      />
      {versions.length === 0 ? (
        <Text variant="footnote" color="muted">No saved versions are available.</Text>
      ) : versions.map((version) => (
        <View key={version.id} style={{ gap: 8, paddingVertical: 8 }}>
          <Text variant="calloutStrong">Version {version.versionNumber}{version.current ? ' · current' : ''}</Text>
          <Text variant="footnote" color="muted">
            {new Date(version.createdAt).toLocaleString()} · {version.published ? 'published at least once' : 'draft only'}
          </Text>
          {version.published && !version.current ? (
            <Button
              title={`Recover version ${version.versionNumber}`}
              variant="outline"
              size="sm"
              disabled={!canRecover || busy || !reason.trim()}
              loading={busy}
              onPress={() => onRecover(version)}
            />
          ) : null}
        </View>
      ))}
    </Card>
  );
}
