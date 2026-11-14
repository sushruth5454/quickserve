-- Payout-account (Razorpay Route linked account) activation states used by 0009_provider_onboarding.sql.
-- Postgres cannot use a new enum value in the transaction that adds it, so the additions live in their own
-- migration (doc 07 §8 rule 2). Razorpay product activation_status values:
-- requested | needs_clarification | under_review | activated | suspended
-- (https://razorpay.com/docs/api/payments/route/request-product-config/).
alter type public.kyc_status add value if not exists 'under_review';
alter type public.kyc_status add value if not exists 'needs_clarification';
alter type public.kyc_status add value if not exists 'suspended';
