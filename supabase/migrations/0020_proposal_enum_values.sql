-- PostgreSQL enum values cannot be used in the same transaction that adds them.
-- Keep this migration transaction-free and run it before 0020_proposal_milestone_booking.sql.
alter type public.booking_status add value if not exists 'confirmed';
alter type public.booking_status add value if not exists 'delivery_pending';
alter type public.quote_item_kind add value if not exists 'material';
alter type public.quote_item_kind add value if not exists 'package';
alter type public.quote_item_kind add value if not exists 'per_unit';
alter type public.quote_item_kind add value if not exists 'travel';
alter type public.quote_item_kind add value if not exists 'rental';
alter type public.quote_item_kind add value if not exists 'discount';
alter type public.quote_item_kind add value if not exists 'addon';
alter type public.payment_purpose add value if not exists 'advance';
alter type public.payment_purpose add value if not exists 'milestone';
alter type public.payment_purpose add value if not exists 'final';
alter type public.payment_purpose add value if not exists 'platform_fee';
alter type public.payment_purpose add value if not exists 'package';
alter type public.payment_purpose add value if not exists 'addon';
alter type public.payment_purpose add value if not exists 'session';
