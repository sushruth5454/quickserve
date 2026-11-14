import type { ComponentType } from 'react';
import type { StepKey } from '../../lib/onboarding/completeness';
import { AreaSection } from './AreaSection';
import { BasicsSection } from './BasicsSection';
import { HoursSection } from './HoursSection';
import type { SectionProps } from './parts';
import { PayoutSection } from './PayoutSection';
import { PortfolioSection } from './PortfolioSection';
import { ServicesSection } from './ServicesSection';

/** Editable sections (review is rendered by the hosts because it needs jump-to-step). */
export const SECTIONS: Record<Exclude<StepKey, 'review'>, { title: string; component: ComponentType<SectionProps> }> = {
  basics: { title: 'About you', component: BasicsSection },
  services: { title: 'Services & skills', component: ServicesSection },
  area: { title: 'Service area', component: AreaSection },
  hours: { title: 'Working hours & time off', component: HoursSection },
  portfolio: { title: 'Work photos & documents', component: PortfolioSection },
  payouts: { title: 'Payouts & verification', component: PayoutSection },
};

export function isSectionKey(s: string | undefined): s is Exclude<StepKey, 'review'> {
  return !!s && s in SECTIONS;
}
