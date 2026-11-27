import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Card, Header, InlineAlert, Input, Screen, Section, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { formatINR, rupeesToPaise } from '../../lib/money';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { getCataloguePackage, type CataloguePackage } from '../catalogue/api';
import { getCreatorProposalConfig, sendProposalWithDeadline } from '../proposals/api';
import { packageProposalPrefill, parseDeliveryDate, proposalAmountError } from '../proposals/model';
import type { ProposalPackagePrefill } from '../proposals/model';
import type { ProposalRequest } from '../../lib/types';

export default function ProposalComposeDetailScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [advance, setAdvance] = useState('25');
  const [delivery, setDelivery] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [revisions, setRevisions] = useState('1');
  const [maxAdvanceBp, setMaxAdvanceBp] = useState(2500);
  const [request, setRequest] = useState<ProposalRequest | null>(null);
  const [packageDetails, setPackageDetails] = useState<CataloguePackage | null>(null);
  const [packagePrefill, setPackagePrefill] = useState<ProposalPackagePrefill | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadlineEnabled = flags.isOn('creator_delivery_deadline') && flags.archetypes.proposal;

  useEffect(() => {
    let active = true;
    if (!requestId) return () => { active = false; };
    setRequest(null);
    setError(null);
    setPackageDetails(null);
    setPackagePrefill(null);
    void Promise.all([
      api.listProviderServiceRequests(),
      getCreatorProposalConfig(),
    ]).then(async ([requests, config]) => {
      const nextRequest = requests.find((row) => row.id === requestId) ?? null;
      if (!nextRequest) throw new Error('This proposal request is no longer available');
      let nextPackage: CataloguePackage | null = null;
      let nextPrefill: ProposalPackagePrefill | null = null;
      const packageId = typeof nextRequest.intake?.package_id === 'string'
        ? nextRequest.intake.package_id
        : null;
      if (packageId) {
        nextPackage = await getCataloguePackage(packageId);
        nextPrefill = packageProposalPrefill(nextPackage.package, nextRequest.event_start);
      }
      if (!active) return;
      setRequest(nextRequest);
      setPackageDetails(nextPackage);
      setPackagePrefill(nextPrefill);
      setMaxAdvanceBp(config.maxAdvanceBp);
      setAdvance(String(config.maxAdvanceBp / 100));
      setRevisions(String(nextPrefill?.revisions ?? config.defaultRevisions));
      if (nextPrefill) {
        setTitle(nextPrefill.title);
        setTotal(String(nextPrefill.totalPaise / 100));
        if (nextPrefill.deliveryDate) setDeliveryDate(nextPrefill.deliveryDate);
      }
      const requestedDate = nextRequest.intake?.deliver_by;
      if (!nextPrefill?.deliveryDate && typeof requestedDate === 'string') setDeliveryDate(requestedDate);
    }).catch((caught: Error) => {
      if (active) setError(caught.message);
    });
    return () => { active = false; };
  }, [requestId]);

  const send = async () => {
    if (!request || error || busy) return;
    setBusy(true); setError(null);
    try {
      if (!requestId || !title.trim()) throw new Error('Add a line item title');
      const totalRupees = Number(total);
      const advancePercent = Number(advance);
      const revisionCount = Number(revisions);
      const amountError = proposalAmountError(totalRupees, advancePercent, maxAdvanceBp);
      if (amountError) throw new Error(amountError);
      if (!Number.isInteger(revisionCount) || revisionCount < 0 || revisionCount > 3) {
        throw new Error('Revisions included must be between 0 and 3');
      }
      const amount = rupeesToPaise(totalRupees);
      const advanceAmount = Math.round(amount * advancePercent / 100);
      const hasDelivery = !!delivery.trim()
        || (packagePrefill?.deliverables ?? []).some((item) => item.type !== 'revisions');
      let deliveryDueAt: Date | null = null;
      if (deadlineEnabled) {
        deliveryDueAt = parseDeliveryDate(deliveryDate);
        if (!deliveryDueAt) throw new Error('Add a valid deliver-by date');
        if (deliveryDueAt.getTime() <= Date.now()) {
          throw new Error('Deliver-by date must be in the future');
        }
        const eventStart = request?.event_start ? new Date(request.event_start) : null;
        if (eventStart && deliveryDueAt.getTime() > eventStart.getTime() + 365 * 24 * 60 * 60 * 1000) {
          throw new Error('Deliver-by date cannot be more than 365 days after the event');
        }
      }
      const deliverables = (packagePrefill?.deliverables ?? []).filter((item) => item.type !== 'revisions');
      if (delivery.trim()) deliverables.push({ type: 'final_delivery', qty: 1, spec: delivery.trim() });
      deliverables.push({ type: 'revisions', qty: revisionCount, spec: 'Revision rounds' });
      await sendProposalWithDeadline({
        requestId,
        items: [{ seq: 1, kind: 'package', title: title.trim(), qty: 1, unit: 'job', unit_price: amount, bill_photo_url: null }],
        schedule: [
          { label: 'Booking advance', amount: advanceAmount, due_rule: 'at_booking' },
          { label: hasDelivery ? 'Delivery balance' : 'Final payment', amount: amount - advanceAmount, due_rule: hasDelivery ? 'on_delivery' : 'on_completion' },
        ],
        validUntil: new Date(Date.now() + 7 * 86400000),
        note,
        deliverables,
        deliveryDueAt,
      });
      toast({ message: 'Proposal sent', tone: 'success' });
      router.back();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title="Send proposal" />}
      footer={request && !error
        ? <Button title="Send fixed proposal" size="lg" fullWidth loading={busy} disabled={busy} onPress={() => void send()} />
        : undefined}
    >
      {error ? <InlineAlert message={error} /> : !request ? <Skeleton height={220} /> : (
        <>
          <Section title="Customer brief">
            <Card>
              <Text>{String(request.intake?.brief ?? 'No free-text brief provided.')}</Text>
              {request.budget_max != null ? <Text color="textSecondary">Budget maximum: {formatINR(request.budget_max)}</Text> : null}
              <Text variant="caption" color="muted">
                {request.intake?.deliver_by
                  ? `Customer requested delivery by ${String(request.intake.deliver_by)}`
                  : `Event date: ${new Date(request.event_start).toLocaleDateString('en-IN')}`}
              </Text>
              {Object.entries(request.intake ?? {})
                .filter(([key]) => !['brief', 'package_id', 'deliver_by'].includes(key))
                .map(([key, value]) => <Text key={key} variant="footnote" color="textSecondary">{`${key.replaceAll('_', ' ')}: ${String(value)}`}</Text>)}
            </Card>
          </Section>
          {packageDetails ? (
            <Section title="Selected package">
              <Card>
                <Text variant="calloutStrong">{packageDetails.package.title}</Text>
                <Text color="textSecondary">{packageDetails.package.description}</Text>
                <Text variant="footnote" color="muted">Package terms are prefilled below; confirm the scope before sending.</Text>
              </Card>
            </Section>
          ) : null}
          <Section title="Scope">
            <Input label="Package / scope" value={title} onChangeText={setTitle} placeholder="Wedding photography · 8 hours" />
            <Input label="Fixed total (₹)" keyboardType="number-pad" value={total} onChangeText={setTotal} />
            <TextArea label="Terms" value={note} onChangeText={setNote} />
            {deadlineEnabled ? (
              <Input label="I will deliver by" placeholder="YYYY-MM-DD" value={deliveryDate} onChangeText={setDeliveryDate} />
            ) : null}
            <Input
              label="Revisions included"
              keyboardType="number-pad"
              value={revisions}
              onChangeText={setRevisions}
              helper="Choose 0 to 3 revision rounds. The agreed count is saved with the booking."
            />
          </Section>
          <Section title="Payment plan">
            <Input label="Advance (%)" keyboardType="number-pad" value={advance} onChangeText={setAdvance} />
            <Card><Text color="textSecondary">Advance is capped at {maxAdvanceBp / 100}%. Remaining balance is due at completion or delivery. The platform fee is collected separately with the advance.</Text></Card>
          </Section>
          <Section title="Deliverables" subtitle="Optional">
            <TextArea label="What will be delivered?" value={delivery} onChangeText={setDelivery} placeholder="Edited gallery, album, turnaround…" />
          </Section>
        </>
      )}
    </Screen>
  );
}
