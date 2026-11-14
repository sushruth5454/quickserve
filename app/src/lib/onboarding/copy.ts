/**
 * Provider onboarding copy in one place so it can move to the i18n layer (Hindi/Telugu) without touching screens.
 */
import type { SkillLevel } from '../types';
import type { GoLiveReason, GoLiveState, Gender } from './types';

export const STEP_LABELS = ['About you', 'Services', 'Area', 'Hours', 'Work & docs', 'Payouts', 'Review'];

export const LANGUAGES = ['Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Urdu', 'Gujarati', 'Odia', 'Punjabi'];

export const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Woman' },
  { value: 'male', label: 'Man' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const SKILL_LEVEL_INFO: Record<SkillLevel, { title: string; description: string }> = {
  beginner: { title: 'Beginner', description: 'Under 1 year of paid work. You handle simple, common jobs.' },
  skilled: { title: 'Skilled', description: '1–5 years. You diagnose and fix most problems on your own.' },
  expert: { title: 'Expert', description: '5+ years. You handle complex repairs and installations.' },
  certified: { title: 'Certified', description: 'You hold a training certificate or licence for this trade (add it under Work & docs).' },
};

export const BIO_MIN = 30;
export const BIO_MAX = 500;
export const BIO_GOOD = 'AC technician for 6 years. I service split and window ACs, do gas refills and installations, and carry my own vacuum pump. Daikin-trained.';
export const BIO_BAD = 'Good work. Call me.';

export const PROVIDER_TERMS_SUMMARY = [
  'Quote before work: you send an itemised quote and start only after the customer approves it.',
  'Payments stay in the app. Taking payment outside QuickServe is not allowed.',
  'Commission is charged on labour only: 0% for your first 30 days, then 12% (10% after 50 jobs, 8% after 200). Parts are 0%.',
  'Payouts are sent to your verified bank account after the 24-hour dispute window.',
  'You follow the safety rules, keep customer details private and behave professionally.',
];

export const GO_LIVE_TITLE: Record<GoLiveState, string> = {
  draft: 'Finish your profile',
  under_review: 'Under review',
  action_needed: 'Action needed',
  live: 'You are live',
  suspended: 'Account suspended',
  deactivated: 'Account deactivated',
};

export const GO_LIVE_BODY: Record<GoLiveState, string> = {
  draft: 'Complete the remaining steps and submit your profile. Customers can find you once you are verified.',
  under_review: 'We are verifying your details. Most checks finish within 1–2 working days. You do not need to do anything right now.',
  action_needed: 'Something needs your attention before customers can book you.',
  live: 'Customers can find and book you in your working hours.',
  suspended: 'Your account is suspended. Contact support for details.',
  deactivated: 'Your account is deactivated and hidden from customers.',
};

export interface ReasonCopy {
  title: string;
  body: string;
  /** Section to open to fix it. */
  section?: 'payouts' | 'portfolio' | 'services' | null;
}

export function reasonCopy(r: GoLiveReason, docLabel?: string): ReasonCopy {
  const doc = docLabel ?? r.doc_type ?? 'document';
  switch (r.code) {
    case 'payout_missing':
      return { title: 'Add your bank account', body: 'We need your PAN and bank details to send your earnings.', section: 'payouts' };
    case 'payout_unavailable':
      return {
        title: 'Payouts setup temporarily unavailable',
        body: "Your profile is saved. Our payment partner setup is not ready yet — we'll notify you when you can finish this step.",
        section: null,
      };
    case 'payout_pending':
      return { title: 'Verifying your bank account', body: 'Our payment partner is checking your PAN and bank details. This usually takes a few minutes to a day.', section: null };
    case 'payout_needs_clarification':
      return { title: 'Check your bank details', body: r.detail || 'Our payment partner could not verify your details. Please check and resubmit.', section: 'payouts' };
    case 'payout_rejected':
      return { title: 'Bank verification failed', body: r.detail || 'Your payout account could not be verified. Contact support.', section: 'payouts' };
    case 'payout_suspended':
      return { title: 'Payout account suspended', body: r.detail || 'Contact support to restore payouts.', section: null };
    case 'doc_missing':
      return { title: `Upload your ${doc}`, body: `${r.category ?? 'This service'} requires a ${doc}.`, section: 'portfolio' };
    case 'doc_pending':
      return { title: `${doc} under review`, body: 'Our team reviews documents within 2 working days.', section: null };
    case 'doc_rejected':
      return { title: `${doc} was not accepted`, body: r.detail || 'Upload a clearer copy.', section: 'portfolio' };
    case 'doc_expired':
      return { title: `${doc} has expired`, body: 'Upload a current copy to stay live.', section: 'portfolio' };
    case 'no_active_service':
      return { title: 'Turn on a service', body: 'You have no active services. Add or resume one.', section: 'services' };
    case 'admin_note':
      return { title: 'Message from QuickServe', body: r.detail || '', section: null };
  }
}

/** Requirement field from Razorpay (Route requirements or RazorpayX validation) → form field. */
export function requirementField(fieldReference: string): 'account_number' | 'ifsc' | 'legal_name' | 'pan' | null {
  if (/ifsc/i.test(fieldReference)) return 'ifsc';
  if (/account_number|bank_account$/i.test(fieldReference)) return 'account_number';
  if (/beneficiary_name|bank_account\.name|name/i.test(fieldReference)) return 'legal_name';
  if (/pan|kyc/i.test(fieldReference)) return 'pan';
  return null;
}
