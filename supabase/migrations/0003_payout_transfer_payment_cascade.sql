-- Deleting a booking cascades to its payments and payouts, but payout_transfers.source_payment_id had no ON DELETE
-- action, so the payments cascade failed whenever the booking had payout transfers (e.g. re-running seed-full.sql,
-- which deletes and re-creates its bookings). Transfers belong to the booking's own payout, so cascade them too.
alter table public.payout_transfers
  drop constraint payout_transfers_source_payment_id_fkey,
  add constraint payout_transfers_source_payment_id_fkey
    foreign key (source_payment_id) references public.payments (id) on delete cascade;
