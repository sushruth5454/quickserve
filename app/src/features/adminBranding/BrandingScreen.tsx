import { useLocalSearchParams } from 'expo-router';
import { Button, Card, Header, InlineAlert, Input, Screen, Skeleton, Text } from '../../components/ui';
import { BrandingForm } from './BrandingForm';
import { BrandingHistory } from './BrandingHistory';
import { BrandingPreview } from './BrandingPreview';
import { useBrandingController } from './useBrandingController';

export default function BrandingScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const controller = useBrandingController();
  const historyFirst = section === 'history';
  const freshnessSubtitle = controller.snapshot
    ? [
      controller.freshnessLabel,
      `generation ${controller.snapshot.generation}`,
      controller.currentVersion ? `current v${controller.currentVersion.versionNumber}` : null,
    ].filter(Boolean).join(' · ')
    : controller.freshnessLabel;

  const history = (
    <BrandingHistory
      versions={controller.history}
      reason={controller.recoveryReason}
      canRecover={controller.freshness === 'live' && controller.snapshot !== null}
      busy={controller.writing || controller.uploadingSlot !== null}
      onReasonChange={controller.setRecoveryReason}
      onRecover={(version) => void controller.recover(version)}
    />
  );

  return (
    <Screen
      header={<Header title="Branding & appearance" subtitle={freshnessSubtitle} />}
      refreshing={controller.freshness === 'loading'}
      onRefresh={() => void controller.refresh()}
    >
      {controller.loadError ? (
        <InlineAlert message={controller.loadError} />
      ) : null}
      {controller.actionError ? (
        <InlineAlert message={controller.actionError} />
      ) : null}
      {controller.notice ? <Text variant="footnote" color="successText">{controller.notice}</Text> : null}
      {controller.snapshot ? (
        <Card>
          <Text variant="title3">Current published appearance</Text>
          {controller.snapshot.config ? (
            <>
              <Text variant="calloutStrong">{controller.snapshot.config.displayName}</Text>
              <Text variant="footnote" color="muted">{controller.snapshot.config.tagline}</Text>
              <Text variant="caption" color="muted">
                {controller.snapshot.config.defaultTheme} theme · generation {controller.snapshot.generation}
              </Text>
            </>
          ) : (
            <Text variant="footnote" color="muted">No remote version is published; the bundled appearance remains in use.</Text>
          )}
        </Card>
      ) : null}
      {controller.freshness === 'stale' || controller.loadError ? (
        <Button
          title="Refresh status and history"
          variant="outline"
          disabled={controller.writing || controller.uploadingSlot !== null}
          onPress={() => void controller.refresh()}
        />
      ) : null}

      {historyFirst ? history : null}

      {controller.draft ? (
        <>
          <BrandingForm
            draft={controller.draft}
            disabled={controller.writing || controller.uploadingSlot !== null}
            editorEnabled={controller.editorEnabled}
            uploadingSlot={controller.uploadingSlot}
            onChange={controller.updateDraft}
            onUpload={(slot) => void controller.uploadAsset(slot)}
            onClear={controller.clearAsset}
          />
          {controller.validationErrors.length > 0 ? (
            <InlineAlert message={controller.validationErrors.join(' ')} />
          ) : null}
          <Button
            title={controller.dirty ? 'Save immutable draft' : 'Draft is unchanged'}
            disabled={!controller.editorEnabled || !controller.dirty || controller.writing || controller.uploadingSlot !== null || controller.validationErrors.length > 0}
            loading={controller.writing && controller.dirty}
            onPress={() => void controller.saveDraft()}
          />
          <Card>
            <Text variant="title3">Publish</Text>
            <Text variant="footnote" color="muted">
              Publishing is immutable and checks the exact server generation shown above. A stale conflict never retries automatically.
            </Text>
            <Input
              label="Publish reason"
              value={controller.publishReason}
              maxLength={500}
              editable={controller.editorEnabled && !controller.writing}
              onChangeText={controller.setPublishReason}
              helper="Required for the audit record (1–500 characters)."
            />
            <Button
              title="Publish saved draft"
              disabled={!controller.canPublish}
              loading={controller.writing && !controller.dirty}
              onPress={() => void controller.publish()}
            />
          </Card>
          <Card>
            <Text variant="title3">Nested preview</Text>
            <Text variant="footnote" color="muted">
              This view uses local draft values only. It does not update global theme, feature flags, identity or cache.
            </Text>
            {controller.previewAppearance ? (
              <BrandingPreview config={controller.previewAppearance} getAssetPreview={controller.getAssetPreview} />
            ) : null}
          </Card>
        </>
      ) : (
        <Skeleton height={280} radius={16} />
      )}

      {!historyFirst ? history : null}
    </Screen>
  );
}
