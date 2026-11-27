import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, FullScreenLoader, Header, Screen } from '../../components/ui';
import { ReviewSection } from '../providerOnboarding/ReviewSection';
import { SECTIONS } from '../providerOnboarding/sections';
import { onboardingCompositionEnabled, OnboardingReadStateProvider, WizardHeader } from '../providerOnboarding/parts';
import { useOnboardingData } from '../providerOnboarding/useOnboardingData';
import { useAuth } from '../../lib/auth';
import { useFeature } from '../../lib/featureFlags';
import { onboardingApi } from '../../lib/onboarding';
import { resumeStep, STEP_KEYS, type StepKey } from '../../lib/onboarding/completeness';

function useOnboardingController() {
  const { setActiveRole } = useAuth();
  const params = useLocalSearchParams<{ step?: string }>();
  const { data, error, readState, reload } = useOnboardingData({ enabled: true });
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!data || step != null) return;
    const requested = STEP_KEYS.indexOf(params.step as StepKey);
    setStep(requested >= 0 ? requested : resumeStep(data.state));
  }, [data, step, params.step]);

  const reloadAfterMutation = useCallback(
    (options?: { afterMutation?: boolean }) => reload({ afterMutation: true, ...options }),
    [reload],
  );

  return { data, error, readState, reload, reloadAfterMutation, step, setStep, setActiveRole };
}

/** Provider onboarding wizard (docs/08-Provider-Onboarding.md): seven resumable steps. */
export default function OnboardingScreen() {
  const brandEnabled = useFeature('oorva_brand');
  const onboardingEnabled = useFeature('oorva_onboarding_ux');
  const oorvaComposition = onboardingCompositionEnabled(brandEnabled, onboardingEnabled);
  const { data, error, readState, reload, reloadAfterMutation, step, setStep, setActiveRole } = useOnboardingController();

  if (readState.status === 'error' && !data) {
    return (
      <Screen header={<Header title="Become a provider" />}>
        <ErrorState message={error} onRetry={() => void reload().catch(() => undefined)} />
      </Screen>
    );
  }
  if (!data || step == null) return <FullScreenLoader />;

  const go = (n: number) => {
    const next = Math.max(0, Math.min(STEP_KEYS.length - 1, n));
    if (data.state.provider && next > (data.state.provider.onboarding_step ?? 0)) void onboardingApi.setStep(next).catch(() => undefined);
    setStep(next);
  };
  const back = step > 0 ? () => go(step - 1) : undefined;
  const header = <WizardHeader step={step} onBack={back ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />;
  const key = STEP_KEYS[step]!;

  return (
    <OnboardingReadStateProvider state={readState} reload={() => reload().catch(() => false)}>
      {key === 'review' ? (
        <ReviewSection
          key="review"
          data={data}
          reload={reloadAfterMutation}
          header={header}
          mode="wizard"
          onBack={back}
          onJump={(s) => go(STEP_KEYS.indexOf(s))}
          onDone={() => {
            setActiveRole('provider');
            router.replace('/dashboard');
          }}
        />
      ) : (
        (() => {
          const Section = SECTIONS[key].component;
          return <Section key={key} data={data} reload={reloadAfterMutation} header={header} mode="wizard" oorvaComposition={oorvaComposition} onBack={back} onDone={() => go(step + 1)} />;
        })()
      )}
    </OnboardingReadStateProvider>
  );
}
