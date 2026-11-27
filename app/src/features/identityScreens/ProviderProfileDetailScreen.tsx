import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ErrorState, FullScreenLoader, Header, Screen } from '../../components/ui';
import { ReviewSection } from '../providerOnboarding/ReviewSection';
import { isSectionKey, SECTIONS } from '../providerOnboarding/sections';
import { OnboardingReadStateProvider, onboardingCompositionEnabled } from '../providerOnboarding/parts';
import { useOnboardingData } from '../providerOnboarding/useOnboardingData';
import { useFeature } from '../../lib/featureFlags';

export function profileSectionReturnTarget(returnTo?: string): '/provider-profile/services' | '/provider-profile' {
  return returnTo === 'services' ? '/provider-profile/services' : '/provider-profile';
}

function useProviderProfileDetailController() {
  const { section, returnTo } = useLocalSearchParams<{ section: string; returnTo?: string }>();
  const { data, error, readState, reload } = useOnboardingData({ enabled: true });
  const returnPath = profileSectionReturnTarget(returnTo);
  const done = () => router.dismissTo(returnPath);
  const reloadAfterMutation = useCallback(
    (options?: { afterMutation?: boolean }) => reload({ afterMutation: true, ...options }),
    [reload],
  );
  return { section, returnTo, data, error, readState, reload, reloadAfterMutation, done };
}

/** One provider-profile section in edit mode (same screens as the onboarding wizard). */
export default function ProviderProfileDetailScreen() {
  const brandEnabled = useFeature('oorva_brand');
  const onboardingEnabled = useFeature('oorva_onboarding_ux');
  const oorvaComposition = onboardingCompositionEnabled(brandEnabled, onboardingEnabled);
  const { section, returnTo, data, error, readState, reload, reloadAfterMutation, done } = useProviderProfileDetailController();

  if (readState.status === 'error' && !data) {
    return (
      <Screen header={<Header title="Provider profile" onBack={done} />}>
        <ErrorState message={error} onRetry={() => void reload().catch(() => undefined)} />
      </Screen>
    );
  }
  if (!data) return <FullScreenLoader />;

  return (
    <OnboardingReadStateProvider state={readState} reload={() => reload().catch(() => false)}>
      {section === 'review' ? (
        <ReviewSection
          data={data}
          reload={reloadAfterMutation}
          header={<Header title="Review & submit" onBack={done} />}
          mode="edit"
          onJump={(step) => router.replace({ pathname: '/provider-profile/[section]', params: { section: step, returnTo: returnTo === 'services' ? 'services' : 'hub' } })}
          onDone={done}
        />
      ) : !isSectionKey(section) ? (
        <Screen header={<Header title="Provider profile" onBack={done} />}>
          <ErrorState title="Section not found" message="This part of your profile does not exist." onRetry={done} />
        </Screen>
      ) : (
        (() => {
          const Section = SECTIONS[section].component;
          return <Section key={section} data={data} reload={reloadAfterMutation} header={<Header title={SECTIONS[section].title} onBack={done} />} mode="edit" oorvaComposition={oorvaComposition} onDone={done} />;
        })()
      )}
    </OnboardingReadStateProvider>
  );
}
