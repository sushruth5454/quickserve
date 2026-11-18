import type { ReactElement, ReactNode } from 'react';
import { Header, Screen } from '../ui/Screen';
import { StepIndicator } from '../ui/Stepper';

export function BookingStepLayout(props: {
  title: string;
  steps: string[];
  current: number;
  footer: ReactNode;
  children: ReactNode;
  onBack?: () => void;
}): ReactElement {
  const { title, steps, current, footer, children, onBack } = props;

  return (
    <Screen header={<Header title={title} onBack={onBack} />} footer={footer}>
      <StepIndicator steps={steps} current={current} />
      {children}
    </Screen>
  );
}
