import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, InlineAlert, Section, Text, useConfirm, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { formatINR } from '../../lib/money';
import { relativeTimeLabel } from '../../lib/schedule';
import { proposalStatus } from '../../lib/proposalStatus';
import type { Proposal, ProposalRequest } from '../../lib/types';
import { listMyBusinessProposals } from '../merchantStaff/api';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Requests routed to this pro, split into ones still needing a reply and proposals already sent. */
export function ProviderProposalInbox({ providerId }: { providerId: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [requests, setRequests] = useState<ProposalRequest[]>([]);
  const [mine, setMine] = useState<Proposal[]>([]);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [allRequests, proposals] = await Promise.all([
        api.listProviderServiceRequests(),
        listMyBusinessProposals(providerId),
      ]);
      setRequests(allRequests.filter((request) => request.provider_id === providerId));
      setMine(proposals);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [providerId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const { pending, sent } = useMemo(() => {
    // Latest proposal per request (a re-sent proposal gets a higher version).
    const latest = new Map<string, Proposal>();
    for (const p of mine) {
      const prev = latest.get(p.request_id);
      if (!prev || p.version > prev.version) latest.set(p.request_id, p);
    }
    const byId = new Map(requests.map((r) => [r.id, r]));
    return {
      pending: requests
        .filter((r) => r.status === 'open' && !latest.has(r.id) && new Date(r.expires_at).getTime() > Date.now())
        .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent)),
      sent: [...latest.values()]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((p) => ({ proposal: p, request: byId.get(p.request_id) ?? null })),
    };
  }, [requests, mine]);

  const withdraw = async (p: Proposal) => {
    const ok = await confirm({
      title: 'Withdraw this proposal?',
      message: 'The customer will no longer be able to accept it. You can send a new one while the request is open.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!ok) return;
    setWithdrawing(p.id);
    try {
      await api.withdrawProposal(p.id);
      toast({ message: 'Proposal withdrawn', tone: 'success' });
      load();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setWithdrawing(null);
    }
  };

  return (
    <>
      <InlineAlert message={error} />
      <Section title="Proposal requests" subtitle={pending.length ? 'Reply with a fixed scope and payment plan' : undefined}>
        {pending.length === 0 ? (
          <EmptyState compact icon="document-text-outline" title="No new requests" message={sent.length ? 'You have replied to every request. New matched requests appear here privately.' : 'New matched requests appear here privately.'} />
        ) : pending.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="calloutStrong" style={{ flex: 1 }} numberOfLines={1}>{r.category_name}</Text>
              {r.urgent ? <Badge label="Urgent" tone="danger" /> : null}
            </View>
            <Text color="textSecondary">
              {r.area || r.city} · {r.urgent ? relativeTimeLabel(new Date(r.event_start), new Date()) : day(r.event_start)}
            </Text>
            {r.urgent ? (
              <Text variant="footnoteStrong" color="dangerText">
                Urgent · reply by {relativeTimeLabel(new Date(r.expires_at), new Date())}
              </Text>
            ) : null}
            <Text variant="caption" color="muted">{String(r.intake?.brief ?? 'Custom event brief')}</Text>
            <Button title="Send proposal" onPress={() => router.push({ pathname: '/proposal/compose/[requestId]', params: { requestId: r.id } })} />
          </Card>
        ))}
      </Section>

      {sent.length ? (
        <Section title="Proposals sent" subtitle="Your quotes and where they stand">
          {sent.map(({ proposal: p, request: r }) => {
            const s = proposalStatus(p);
            const canResend = r?.status === 'open' && (p.status === 'withdrawn' || p.status === 'expired' || p.status === 'rejected');
            return (
              <Card key={p.id} onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id } })} accessibilityLabel={`${r?.category_name ?? 'Proposal'}, ${formatINR(p.total)}, ${s.label}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="calloutStrong" style={{ flex: 1 }} numberOfLines={1}>{r?.category_name ?? 'Proposal'}</Text>
                  <Badge label={s.label} tone={s.tone} />
                </View>
                <Text variant="title3" tabular>{formatINR(p.total)}</Text>
                <Text variant="footnote" color="textSecondary">
                  {[r ? `${r.area || r.city} · event ${day(r.event_start)}` : null, `sent ${day(p.created_at)}`, p.status === 'sent' ? `valid until ${day(p.valid_until)}` : null].filter(Boolean).join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="View" variant="outline" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id } })} />
                  {p.status === 'sent' ? (
                    <Button title="Withdraw" variant="destructiveGhost" style={{ flex: 1 }} loading={withdrawing === p.id} onPress={() => void withdraw(p)} />
                  ) : canResend ? (
                    <Button title="Send new proposal" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/proposal/compose/[requestId]', params: { requestId: p.request_id } })} />
                  ) : null}
                </View>
              </Card>
            );
          })}
        </Section>
      ) : null}
    </>
  );
}
