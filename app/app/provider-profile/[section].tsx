import { router, useLocalSearchParams } from 'expo-router';
import { ErrorState, FullScreenLoader, Header, Screen } from '../../src/components/ui';
import { ReviewSection } from '../../src/features/providerOnboarding/ReviewSection';
import { isSectionKey, SECTIONS } from '../../src/features/providerOnboarding/sections';
import { useOnboardingData } from '../../src/features/providerOnboarding/useOnboardingData';

/** One provider-profile section in edit mode (same screens as the onboarding wizard). */
export default function ProviderProfileSection() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const { data, error, reload } = useOnboardingData();
  const done = () => (router.canGoBack() ? router.back() : router.replace('/provider-profile'));

  if (error && !data) {
    return (
      <Screen header={<Header title="Provider profile" />}>
        <ErrorState message={error} onRetry={() => void reload()} />
      </Screen>
    );
  }
  if (!data) return <FullScreenLoader />;

  if (section === 'review') {
    return (
      <ReviewSection
        data={data}
        reload={reload}
        header={<Header title="Review & submit" />}
        mode="edit"
        onJump={(s) => router.replace({ pathname: '/provider-profile/[section]', params: { section: s } })}
        onDone={done}
      />
    );
  }
  if (!isSectionKey(section)) {
    return (
      <Screen header={<Header title="Provider profile" />}>
        <ErrorState title="Section not found" message="This part of your profile does not exist." onRetry={done} />
      </Screen>
    );
  }
  const S = SECTIONS[section];
  return <S.component key={section} data={data} reload={reload} header={<Header title={S.title} />} mode="edit" onDone={done} />;
}
