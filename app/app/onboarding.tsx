import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ErrorState, FullScreenLoader, Header, Screen } from '../src/components/ui';
import { ReviewSection } from '../src/features/providerOnboarding/ReviewSection';
import { SECTIONS } from '../src/features/providerOnboarding/sections';
import { WizardHeader } from '../src/features/providerOnboarding/parts';
import { useOnboardingData } from '../src/features/providerOnboarding/useOnboardingData';
import { useAuth } from '../src/lib/auth';
import { onboardingApi } from '../src/lib/onboarding';
import { resumeStep, STEP_KEYS, type StepKey } from '../src/lib/onboarding/completeness';

/**
 * Provider onboarding wizard (docs/08-Provider-Onboarding.md): 7 resumable steps, progress saved server-side
 * (providers.onboarding_step). Each step is the same section screen used later under Me → Provider profile.
 */
export default function ProviderOnboarding() {
  const { setActiveRole } = useAuth();
  const params = useLocalSearchParams<{ step?: string }>();
  const { data, error, reload } = useOnboardingData();
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!data || step != null) return;
    const requested = STEP_KEYS.indexOf(params.step as StepKey);
    setStep(requested >= 0 ? requested : resumeStep(data.state));
  }, [data, step, params.step]);

  if (error && !data) {
    return (
      <Screen header={<Header title="Become a provider" />}>
        <ErrorState message={error} onRetry={() => void reload()} />
      </Screen>
    );
  }
  if (!data || step == null) return <FullScreenLoader />;

  const go = (n: number) => {
    const next = Math.max(0, Math.min(STEP_KEYS.length - 1, n));
    // Remember the furthest step for resume; failures are harmless (the checks decide resume too).
    if (data.state.provider && next > (data.state.provider.onboarding_step ?? 0)) void onboardingApi.setStep(next).catch(() => undefined);
    setStep(next);
  };
  const back = step > 0 ? () => go(step - 1) : undefined;
  const header = <WizardHeader step={step} onBack={back ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />;
  const key = STEP_KEYS[step]!;

  if (key === 'review') {
    return (
      <ReviewSection
        key="review"
        data={data}
        reload={reload}
        header={header}
        mode="wizard"
        onBack={back}
        onJump={(s) => go(STEP_KEYS.indexOf(s))}
        onDone={() => {
          setActiveRole('provider');
          router.replace('/dashboard');
        }}
      />
    );
  }
  const Section = SECTIONS[key].component;
  return <Section key={key} data={data} reload={reload} header={header} mode="wizard" onBack={back} onDone={() => go(step + 1)} />;
}