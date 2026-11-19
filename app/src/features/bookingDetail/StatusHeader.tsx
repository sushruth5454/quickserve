import { StatusHero } from '../../components/StatusHero';
import { InlineAlert } from '../../components/ui';
import { useT } from '../../i18n';
import { friendlyError } from '../../lib/errors';
import type { Booking, BookingEvent } from '../../lib/types';
import { PaymentScheduleTimeline } from '../catalogue/PaymentScheduleTimeline';
import type { BookingHeroCopy } from './model';

export function StatusHeader({
  status,
  copy,
  events,
  archetype,
  actionError,
  bookingId,
  isCustomer,
  onPaid,
}: {
  status: Booking['status'];
  copy: BookingHeroCopy;
  events: BookingEvent[];
  archetype: Booking['archetype'];
  actionError: string | null;
  bookingId: string;
  isCustomer: boolean;
  onPaid: () => void;
}) {
  const t = useT();
  const friendlyActionError = actionError ? t(friendlyError(actionError).key) : null;

  return (
    <>
      <StatusHero status={status} copy={copy} events={events} archetype={archetype} />
      <InlineAlert message={friendlyActionError} />
      {/* Single payment schedule view; the footer collects the first payment while the booking is pending. */}
      <PaymentScheduleTimeline key={`${bookingId}:${status}`} bookingId={bookingId} canPay={isCustomer} showPay={status !== 'pending_payment'} onPaid={onPaid} />
    </>
  );
}
