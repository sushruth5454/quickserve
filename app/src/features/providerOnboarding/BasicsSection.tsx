import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, BottomSheet, Card, Chip, InlineAlert, Input, ListItem, Screen, Stepper, Text, TextArea, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { onboardingApi, type Gender } from '../../lib/onboarding';
import { BIO_BAD, BIO_GOOD, BIO_MAX, BIO_MIN, GENDERS, LANGUAGES } from '../../lib/onboarding/copy';
import { validateBasics, type BasicsErrors } from '../../lib/onboarding/validation';
import { useTheme } from '../../theme';
import { pickPhoto, type PickedFile } from './media';
import { FieldLabel, Intro, SectionFooter, type SectionProps } from './parts';
import { useDraft } from './useOnboardingData';

interface Draft {
  fullName: string;
  bio: string;
  languages: string[];
  years: number;
  gender: Gender | null;
}

export function BasicsSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const { userId } = useAuth();
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;
  const p = data.state.provider;
  const initialState = {
    form: {
      fullName: userId ? data.state.profile?.full_name ?? '' : '',
      bio: userId ? p?.bio ?? '' : '',
      languages: userId && p?.languages?.length ? p.languages : [],
      years: userId ? p?.years_experience ?? 0 : 0,
      gender: userId ? p?.gender ?? null : null,
    } satisfies Draft,
    photo: null as PickedFile | null,
    photoSheet: false,
    showExamples: false,
    errors: {} as BasicsErrors,
    error: null as string | null,
    saving: false,
  };
  type SectionState = typeof initialState;
  const [ownedState, setOwnedState] = useState<{ ownerId: string | null; value: SectionState }>({
    ownerId: userId,
    value: initialState,
  });
  const sectionState = ownedState.ownerId === userId ? ownedState.value : initialState;
  const updateSectionState = (update: (current: SectionState) => SectionState) => {
    if (currentUserIdRef.current !== userId) return;
    setOwnedState((current) => ({
      ownerId: userId,
      value: update(current.ownerId === userId ? current.value : initialState),
    }));
  };
  const { form, photo, photoSheet, showExamples, errors, error, saving } = sectionState;
  const setForm = (next: Draft | ((current: Draft) => Draft)) =>
    updateSectionState((current) => ({
      ...current,
      form: typeof next === 'function' ? next(current.form) : next,
    }));
  const setPhoto = (value: PickedFile | null) => updateSectionState((current) => ({ ...current, photo: value }));
  const setPhotoSheet = (value: boolean) => updateSectionState((current) => ({ ...current, photoSheet: value }));
  const setShowExamples = (value: boolean | ((current: boolean) => boolean)) =>
    updateSectionState((current) => ({
      ...current,
      showExamples: typeof value === 'function' ? value(current.showExamples) : value,
    }));
  const setErrors = (value: BasicsErrors) => updateSectionState((current) => ({ ...current, errors: value }));
  const setError = (value: string | null) => updateSectionState((current) => ({ ...current, error: value }));
  const setSaving = (value: boolean) => updateSectionState((current) => ({ ...current, saving: value }));
  const draft = useDraft<Draft>(userId, 'provider-basics', form, (d) => setForm((f) => ({ ...f, ...d })));
  const existingAvatar = userId ? data.state.profile?.avatar_url ?? null : null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Open the picker over the sheet and close the sheet afterwards: dismissing the sheet's iOS modal while the
  // picker is opening also dismisses the picker, so no photo comes back.
  const choose = async (source: 'camera' | 'library') => {
    try {
      const f = await pickPhoto('avatar', source);
      if (f) setPhoto(f);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoSheet(false);
    }
  };

  const save = async () => {
    const ownerId = userId;
    if (!ownerId || currentUserIdRef.current !== ownerId) return;
    const e = validateBasics({ fullName: form.fullName, hasPhoto: !!photo || !!existingAvatar, bio: form.bio, languages: form.languages });
    setErrors(e);
    if (Object.keys(e).length) {
      setError('Please fix the highlighted fields.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const avatarUrl = photo ? await onboardingApi.uploadAvatar(photo.uri, photo.mimeType) : null;
      if (currentUserIdRef.current !== ownerId) return;
      await onboardingApi.saveBasics({
        fullName: form.fullName.trim(),
        avatarUrl,
        gender: form.gender,
        languages: form.languages,
        yearsExperience: form.years,
        bio: form.bio.trim(),
      });
      if (currentUserIdRef.current !== ownerId) return;
      await draft.clear();
      if (currentUserIdRef.current !== ownerId) return;
      await reload();
      if (currentUserIdRef.current !== ownerId) return;
      if (mode === 'edit') toast({ message: 'Profile saved', tone: 'success' });
      onDone();
    } catch (err) {
      if (currentUserIdRef.current === ownerId) setError((err as Error).message);
    } finally {
      if (currentUserIdRef.current === ownerId) setSaving(false);
    }
  };

  const bioLen = form.bio.trim().length;

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={<SectionFooter primary={mode === 'wizard' ? 'Save & continue' : 'Save'} onPrimary={() => void save()} loading={saving} onBack={onBack} />}
    >
      <Intro title="Tell customers about you" subtitle="This is your public profile. Customers see it before they book." />
      <InlineAlert message={error} />

      <View style={{ alignItems: 'center', gap: t.spacing.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change profile photo" onPress={() => setPhotoSheet(true)}>
          <Avatar name={form.fullName || 'You'} uri={photo?.uri ?? existingAvatar} size={104} />
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: t.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 3,
              borderColor: t.colors.bg,
            }}
          >
            <Ionicons name="camera" size={16} color="#FFFFFF" />
          </View>
        </Pressable>
        <Text variant="footnote" color={errors.photo ? 'dangerText' : 'muted'} align="center">
          {errors.photo ?? 'Clear photo of your face, good light, no sunglasses or group photos.'}
        </Text>
      </View>

      <Input
        label="Full name"
        value={form.fullName}
        onChangeText={(v) => set('fullName', v)}
        leftIcon="person-outline"
        autoComplete="name"
        error={errors.fullName}
        maxLength={60}
      />

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel hint="Optional. Used only so customers who ask for a woman or man professional can be matched. Not shown on your profile.">
          Gender
        </FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Gender">
          {GENDERS.map((g) => (
            <Chip key={g.value} label={g.label} selected={form.gender === g.value} onPress={() => set('gender', form.gender === g.value ? null : g.value)} />
          ))}
        </View>
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel error={errors.languages}>Languages you speak</FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {LANGUAGES.map((l) => (
            <Chip
              key={l}
              label={l}
              selected={form.languages.includes(l)}
              onPress={() => set('languages', form.languages.includes(l) ? form.languages.filter((x) => x !== l) : [...form.languages, l])}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <FieldLabel>Years of experience</FieldLabel>
        <Stepper value={form.years} min={0} max={60} onChange={(v) => set('years', v)} label="Years of experience" />
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <TextArea
          label="Short bio"
          placeholder="What you do, how long you've done it, what you're best at"
          value={form.bio}
          onChangeText={(v) => set('bio', v)}
          maxLength={BIO_MAX}
          error={errors.bio}
          helper={bioLen < BIO_MIN ? `${BIO_MIN - bioLen} more characters needed` : `${bioLen}/${BIO_MAX}`}
        />
        <Pressable accessibilityRole="button" onPress={() => setShowExamples((s) => !s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={showExamples ? 'chevron-up' : 'chevron-down'} size={14} color={t.colors.primaryText} />
          <Text variant="footnoteStrong" color="primaryText">
            {showExamples ? 'Hide examples' : 'See a good and a weak bio'}
          </Text>
        </Pressable>
        {showExamples ? (
          <Card gap={t.spacing.sm} variant="filled">
            <Text variant="footnoteStrong" color="successText">
              Good
            </Text>
            <Text variant="footnote" color="textSecondary">
              “{BIO_GOOD}”
            </Text>
            <Text variant="footnoteStrong" color="dangerText">
              Too vague
            </Text>
            <Text variant="footnote" color="textSecondary">
              “{BIO_BAD}” — says nothing about your skills, and phone numbers are not allowed.
            </Text>
          </Card>
        ) : null}
      </View>

      <BottomSheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title="Profile photo">
        <View style={{ marginHorizontal: -t.spacing.xl }}>
          <ListItem icon="camera-outline" title="Take a photo" onPress={() => void choose('camera')} />
          <ListItem icon="images-outline" title="Choose from gallery" onPress={() => void choose('library')} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
