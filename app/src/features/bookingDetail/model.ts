import { formatINR } from '../../lib/money';
import type { BookingArchetype, BookingStatus } from '../../lib/types';

export interface BookingHeroCopy {
  title: string;
  subtitle?: string;
}

export function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function heroCopy(p: {
  status: BookingStatus;
  archetype: BookingArchetype;
  isCustomer: boolean;
  first: string;
  visitFee: number;
  startCode: string | null;
  endCode: string | null;
  changeOrderOpen: boolean;
  cancelledReason: string | null;
  defaultStatusLabel: string;
}): BookingHeroCopy {
  const { first } = p;
  const refundLine = 'Any payment you made is refunded — see Payments below.';
  if (p.isCustomer) {
    switch (p.status) {
      case 'pending_payment':
        if (p.archetype === 'proposal') return { title: 'Pay the advance to confirm', subtitle: `Your hold keeps ${first} reserved for 30 minutes. Pay the booking advance and platform fee below.` };
        if (p.archetype === 'fixed') return { title: 'Pay to confirm your booking', subtitle: `Pay the package price to send the booking to ${first}. It's refunded if they can't take it.` };
        if (p.archetype === 'time_based') return { title: 'Pay to confirm your session', subtitle: `Pay for the session to send it to ${first}. It's refunded if they can't take it.` };
        return { title: 'Pay the visit fee to send your request', subtitle: `${first} is notified as soon as the ${formatINR(p.visitFee)} visit fee is paid. It's adjusted in your final bill.` };
      case 'confirmed':
        if (p.archetype === 'proposal') return { title: 'Booking confirmed', subtitle: p.startCode ? `Share code ${p.startCode} with ${first} when the work starts.` : `Share your start code with ${first} when the work starts.` };
        return { title: 'Booking confirmed', subtitle: `${first} has your booking. Any remaining milestones are in the payment timeline.` };
      case 'delivery_pending':
        return { title: `Waiting for ${first}'s delivery`, subtitle: 'Review the delivery when it arrives. The final milestone is due on delivery.' };
      case 'requested':
        return {
          title: `Waiting for ${first} to accept`,
          subtitle: p.archetype === 'inspect_quote'
            ? 'Pros respond within 15 minutes. If not, your visit fee is refunded automatically.'
            : 'Pros respond within 15 minutes. If not, your payment is refunded automatically.',
        };
      case 'accepted':
        return { title: `${first} accepted your booking`, subtitle: p.startCode ? `Share code ${p.startCode} when ${first} arrives.` : `Share your start code when ${first} arrives.` };
      case 'en_route':
        return { title: `${first} is on the way`, subtitle: p.startCode ? `Share code ${p.startCode} when they arrive.` : 'Keep your start code ready.' };
      case 'inspecting':
        return { title: `${first} is inspecting the problem`, subtitle: "You'll get an itemised quote to approve before any work starts." };
      case 'quote_sent':
        return { title: `${first} sent a quote — review & approve`, subtitle: 'Nothing more is charged until you approve.' };
      case 'awaiting_payment':
        return { title: 'Pay the balance to start work', subtitle: 'Your payment is held safely until the job is done.' };
      case 'in_progress':
        return p.changeOrderOpen
          ? { title: `${first} sent a change order`, subtitle: 'Review the extra work below. Declining keeps the approved scope.' }
          : { title: 'Work in progress', subtitle: 'Your payment is held safely until you confirm the job is done.' };
      case 'completion_requested':
        return { title: `${first} marked the job done`, subtitle: p.endCode ? `Check the work, then share code ${p.endCode}.` : 'Check the work, then share your completion code.' };
      case 'completed':
      case 'closed':
        return { title: 'Job completed', subtitle: 'Thanks for booking with QuickServe.' };
      case 'closed_no_work':
        return { title: 'Closed — no work done', subtitle: 'The quote was declined, so only the inspection was charged.' };
      case 'declined':
        return { title: `${first} couldn't take this job`, subtitle: refundLine };
      case 'expired':
        return { title: 'Request expired', subtitle: refundLine };
      case 'cancelled':
        return { title: 'Booking cancelled', subtitle: p.cancelledReason ?? 'See Payments below for any refund.' };
      case 'disputed':
        return { title: 'Support is reviewing your report', subtitle: 'Payment to the pro is paused until it is resolved.' };
      case 'refunded':
        return { title: 'Refunded', subtitle: 'Your payment has been refunded.' };
    }
  }
  switch (p.status) {
    case 'confirmed':
      return p.archetype === 'proposal'
        ? { title: 'Booking confirmed', subtitle: `When the work starts, ask ${first} for the 4-digit start code.` }
        : { title: p.defaultStatusLabel };
    case 'delivery_pending':
      return { title: 'Prepare the deliverables', subtitle: `Submit the delivery links so ${first} can review them.` };
    case 'requested':
      return { title: `New request from ${first}`, subtitle: 'Accept or decline from your Jobs tab within 15 minutes.' };
    case 'accepted':
      return { title: `Head to ${first}'s address`, subtitle: 'Tap Start trip when you leave.' };
    case 'en_route':
      return { title: 'Arrived? Enter the start code', subtitle: `Ask ${first} for the 4-digit start code.` };
    case 'inspecting':
      return { title: 'Inspect and send a quote', subtitle: 'List labour, parts and other charges. The customer approves and pays before work starts.' };
    case 'quote_sent':
      return { title: 'Quote sent — waiting for approval', subtitle: 'Sending a new quote replaces the open one.' };
    case 'awaiting_payment':
      return { title: 'Quote approved', subtitle: `Waiting for ${first}'s payment before work starts.` };
    case 'in_progress':
      return p.changeOrderOpen
        ? { title: 'Work in progress', subtitle: `A change order is waiting for ${first}'s approval.` }
        : { title: 'Work in progress', subtitle: 'Mark the job done when you finish.' };
    case 'completion_requested':
      return { title: 'Enter the completion code', subtitle: `Ask ${first} for the 4-digit completion code.` };
    case 'completed':
    case 'closed':
      return { title: 'Job complete', subtitle: 'Your payout is released after the 24-hour dispute window.' };
    case 'disputed':
      return { title: 'Customer raised a dispute', subtitle: 'Your payout is on hold until support resolves it.' };
    case 'cancelled':
      return { title: 'Booking cancelled', subtitle: p.cancelledReason ?? undefined };
    default:
      return { title: p.defaultStatusLabel };
  }
}
