import { StatusHero } from '../../components/StatusHero';
import { InlineAlert } from '../../components/ui';
import { useT } from '../../i18n';
import { friendlyError } from '../../lib/errors';
import type { Booking, BookingEvent, PaymentSchedule } from '../../lib/types';
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
  paymentSchedule,
  scheduleLoading,
  scheduleError,
  onRetry,
  onPayDue,
  paying,
}: {
  status: Booking['status'];
  copy: BookingHeroCopy;
  events: BookingEvent[];
  archetype: Booking['archetype'];
  actionError: string | null;
  bookingId: string;
  isCustomer: boolean;
  paymentSchedule: PaymentSchedule[] | null;
  scheduleLoading: boolean;
  scheduleError: string | null;
  onRetry: () => void;
  onPayDue: () => void;
  paying: boolean;
}) {
  const t = useT();
  const friendlyActionError = actionError ? t(friendlyError(actionError).key) : null;

  return (
    <>
      <StatusHero status={status} copy={copy} events={events} archetype={archetype} />
      <InlineAlert message={friendlyActionError} />
      {/* Single payment schedule view; the footer collects the first payment while the booking is pending. */}
      <PaymentScheduleTimeline
        bookingId={bookingId}
        items={paymentSchedule}
        loading={scheduleLoading}
        error={scheduleError}
        onRetry={onRetry}
        canPay={isCustomer}
        showPay={status !== 'pending_payment'}
        onPayDue={onPayDue}
        paying={paying}
      />
    </>
  );
}
