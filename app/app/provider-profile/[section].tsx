import { router, useLocalSearchParams } from 'expo-router';
import { ErrorState, FullScreenLoader, Header, Screen } from '../../src/components/ui';
import { ReviewSection } from '../../src/features/providerOnboarding/ReviewSection';
import { isSectionKey, SECTIONS } from '../../src/features/providerOnboarding/sections';
import { useOnboardingData } from '../../src/features/providerOnboarding/useOnboardingData';

/** One provider-profile section in edit mode (same screens as the onboarding wizard). */
export default function ProviderProfileSection() {
  const { section, returnTo } = useLocalSearchParams<{ section: string; returnTo?: string }>();
  const { data, error, reload } = useOnboardingData();
  const returnPath = returnTo === 'services' ? '/provider-profile/services' : '/provider-profile';
  const done = () => router.replace(returnPath);

  if (error && !data) {
    return (
      <Screen header={<Header title="Provider profile" onBack={done} />}>
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
        header={<Header title="Review & submit" onBack={done} />}
        mode="edit"
        onJump={(s) => router.replace({ pathname: '/provider-profile/[section]', params: { section: s, returnTo: returnTo === 'services' ? 'services' : 'hub' } })}
        onDone={done}
      />
    );
  }
  if (!isSectionKey(section)) {
    return (
      <Screen header={<Header title="Provider profile" onBack={done} />}>
        <ErrorState title="Section not found" message="This part of your profile does not exist." onRetry={done} />
      </Screen>
    );
  }
  const S = SECTIONS[section];
  return <S.component key={section} data={data} reload={reload} header={<Header title={S.title} onBack={done} />} mode="edit" onDone={done} />;
}
