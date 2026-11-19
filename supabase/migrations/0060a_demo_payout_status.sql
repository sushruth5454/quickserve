-- WP X3; owns: payout_status; sources: WS8-T02, WS6-T04
alter type public.payout_status add value if not exists 'demo';
