import { View } from 'react-native';
import { Button, Card, Input, Text, TextArea } from '../../components/ui';
import { EDITABLE_COLOR_KEYS, type BrandingDraft } from './model';
import type { BrandingAssetSlot } from './useBrandingController';

const ASSET_SLOTS: { slot: Exclude<BrandingAssetSlot, 'promotional'>; label: string }[] = [
  { slot: 'logoLight', label: 'Light horizontal logo' },
  { slot: 'logoDark', label: 'Dark horizontal logo' },
  { slot: 'compactLight', label: 'Light compact logo' },
  { slot: 'compactDark', label: 'Dark compact logo' },
];

export function BrandingForm({
  draft,
  disabled,
  editorEnabled,
  uploadingSlot,
  onChange,
  onUpload,
  onClear,
}: {
  draft: BrandingDraft;
  disabled: boolean;
  editorEnabled: boolean;
  uploadingSlot: BrandingAssetSlot | null;
  onChange: (draft: BrandingDraft) => void;
  onUpload: (slot: BrandingAssetSlot) => void;
  onClear: (slot: BrandingAssetSlot, index?: number) => void;
}) {
  const updateText = (key: 'displayName' | 'tagline', value: string) => {
    onChange({ ...draft, config: { ...draft.config, [key]: value } });
  };

  const updateColor = (mode: 'light' | 'dark', key: (typeof EDITABLE_COLOR_KEYS)[number], value: string) => {
    const palette = { ...draft.config[mode] };
    if (value === '') delete palette[key];
    else palette[key] = value;
    onChange({ ...draft, config: { ...draft.config, [mode]: palette } });
  };

  return (
    <>
      {editorEnabled ? null : (
        <Card variant="filled">
          <Text variant="calloutStrong">Branding writes are off</Text>
          <Text variant="footnote" color="muted">
            Local edits remain on this screen only. Saving a new version, uploading images and ordinary publishes require the brand, runtime and editor capabilities to be enabled. Existing history and admin recovery remain available.
          </Text>
        </Card>
      )}
      <Card>
        <Text variant="title3">Identity</Text>
        <Input
          label="Display name"
          value={draft.config.displayName}
          maxLength={32}
          editable={!disabled}
          onChangeText={(value) => updateText('displayName', value)}
        />
        <TextArea
          label="Tagline"
          value={draft.config.tagline}
          maxLength={80}
          editable={!disabled}
          onChangeText={(value) => updateText('tagline', value)}
        />
        <Text variant="footnote" color="muted">Heading font is fixed to bundled Inter; no native identity or startup assets are changed.</Text>
      </Card>

      <Card>
        <Text variant="title3">Default theme</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <Button
              key={theme}
              title={theme[0]!.toUpperCase() + theme.slice(1)}
              variant={draft.config.defaultTheme === theme ? 'primary' : 'outline'}
              size="sm"
              disabled={disabled}
              onPress={() => onChange({
                ...draft,
                config: { ...draft.config, defaultTheme: theme },
              })}
            />
          ))}
        </View>
      </Card>

      {(['light', 'dark'] as const).map((mode) => (
        <Card key={mode}>
          <Text variant="title3">{mode === 'light' ? 'Light' : 'Dark'} color tokens</Text>
          <Text variant="footnote" color="muted">Only approved six-digit hex tokens are accepted. Leave a field blank to inherit its bundled value.</Text>
          {EDITABLE_COLOR_KEYS.map((key) => (
            <Input
              key={`${mode}-${key}`}
              label={key}
              value={draft.config[mode][key] ?? ''}
              placeholder="Inherited"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={7}
              editable={!disabled}
              onChangeText={(value) => updateColor(mode, key, value)}
            />
          ))}
        </Card>
      ))}

      <Card>
        <Text variant="title3">Launch motion preference</Text>
        <Input
          label="Launch reveal duration (milliseconds)"
          value={draft.launchDurationMs}
          keyboardType="number-pad"
          maxLength={4}
          editable={!disabled}
          onChangeText={(value) => onChange({ ...draft, launchDurationMs: value })}
          helper="0–1800 ms. Native startup and installed identity cannot be remotely reverted."
        />
      </Card>

      <Card>
        <Text variant="title3">Approved PNG assets</Text>
        <Text variant="footnote" color="muted">
          Upload only approved public branding images. Assets are privately stored, validated by the server, and preview links expire automatically.
        </Text>
        {ASSET_SLOTS.map(({ slot, label }) => {
          const assetId = draft.config.assets[slot];
          return (
            <View key={slot} style={{ gap: 8 }}>
              <Text variant="calloutStrong">{label}</Text>
              <Text variant="footnote" color="muted">{assetId ? `Registered asset · ${assetId}` : 'No uploaded image selected'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button
                  title={`Upload ${label}`}
                  size="sm"
                  disabled={!editorEnabled || disabled || uploadingSlot !== null}
                  loading={uploadingSlot === slot}
                  onPress={() => onUpload(slot)}
                />
                <Button
                  title="Clear"
                  variant="outline"
                  size="sm"
                  disabled={disabled || !assetId || uploadingSlot !== null}
                  onPress={() => onClear(slot)}
                />
              </View>
            </View>
          );
        })}
        <Text variant="calloutStrong">Promotional images ({draft.config.assets.promotional.length}/6)</Text>
        {draft.config.assets.promotional.map((assetId, index) => (
          <View key={`${assetId}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="footnote" color="muted" style={{ flex: 1 }}>Registered asset · {assetId}</Text>
            <Button
              title="Remove"
              variant="outline"
              size="sm"
              disabled={disabled || uploadingSlot !== null}
              onPress={() => onClear('promotional', index)}
            />
          </View>
        ))}
        <Button
          title="Upload promotional image"
          variant="outline"
          size="sm"
          disabled={!editorEnabled || disabled || uploadingSlot !== null || draft.config.assets.promotional.length >= 6}
          loading={uploadingSlot === 'promotional'}
          onPress={() => onUpload('promotional')}
        />
      </Card>
    </>
  );
}
