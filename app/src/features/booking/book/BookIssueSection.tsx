import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';
import { Chip, Text, TextArea } from '../../../components/ui';
import { DESCRIPTION_MAX } from '../../../lib/assistant/prefill';
import type { BookScreenController } from './useBookScreenController';
import { Block } from './BookControls';

export function BookIssueSection({ controller }: { controller: BookScreenController }) {
  const { t, selectedIssues, toggleIssue, description, setDescription, photos, pickPhoto, setPhotos } = controller;
  const issues: string[] = [];
  return (
    <Block title="Describe the issue" hint="Pick what applies or write it in your words">
      {issues.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {issues.map((q) => (
            <Chip key={q} label={q} selected={selectedIssues.has(q.toLowerCase())} onPress={() => toggleIssue(q)} />
          ))}
        </View>
      ) : null}
      <TextArea
        placeholder="e.g. Split AC not cooling and making a rattling noise"
        value={description}
        onChangeText={setDescription}
        maxLength={DESCRIPTION_MAX}
        counter={`${description.length}/${DESCRIPTION_MAX}`}
        accessibilityLabel="Describe the problem"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -t.spacing.lg }}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}
      >
        {photos.length < 4 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add photo, ${photos.length} of 4 added`}
            onPress={() => void pickPhoto()}
            style={({ pressed }) => ({
              width: 72,
              height: 72,
              borderRadius: t.radii.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: t.colors.outline,
              backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            })}
          >
            <Ionicons name="camera-outline" size={20} color={t.colors.textSecondary} />
            <Text variant="caption" color="textSecondary">
              {photos.length ? `${photos.length}/4` : 'Photo'}
            </Text>
          </Pressable>
        ) : null}
        {photos.map((p) => (
          <View key={p.uri}>
            <Image source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: t.radii.md }} contentFit="cover" accessibilityLabel="Problem photo" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => setPhotos((ps) => ps.filter((x) => x.uri !== p.uri))}
              hitSlop={10}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: 'rgba(16,24,40,0.7)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={14} color={t.colors.onPrimary} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Block>
  );
}
