import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Badge, Button, Card, InlineAlert, Input, Screen, Text, useToast } from '../../components/ui';
import { supportContact } from '../../lib/config';
import { onboardingApi, type PayoutAccount, type PayoutFieldErrors, type PayoutForm } from '../../lib/onboarding';
import { requirementField } from '../../lib/onboarding/copy';
import { validatePayoutForm } from '../../lib/onboarding/validation';
import { useTheme } from '../../theme';
import { Intro, SectionFooter, type SectionProps } from './parts';

type View_ = 'none' | 'unavailable' | 'pending' | 'verified' | 'attention' | 'rejected' | 'suspended';

export function payoutView(p: PayoutAccount | null, kyc: string | undefined): View_ {
  if (!p) return kyc === 'verified' ? 'verified' : 'none';
  if (p.last_error === 'gateway_unavailable') return 'unavailable';
  if (kyc === 'verified' || p.activation_status === 'activated') return 'verified';
  if (kyc === 'suspended' || p.activation_status === 'suspended') return 'suspended';
  if (kyc === 'rejected' || p.activation_status === 'rejected') return 'rejected';
  if (kyc === 'needs_clarification' || p.activation_status === 'needs_clarification') return 'attention';
  return 'pending';
}

const EMPTY: PayoutForm = { legal_name: '', pan: '', email: '', account_number: '', confirm_account_number: '', ifsc: '' };

export function PayoutSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const payout = data.state.payout;
  const view = payoutView(payout, data.state.provider?.kyc_status);
  const [rail, setRail] = useState<'route' | 'payouts'>(payout?.rail ?? 'payouts');
  const [form, setForm] = useState<PayoutForm>({ ...EMPTY, legal_name: payout?.beneficiary_name ?? data.state.profile?.full_name ?? '' });
  const [errors, setErrors] = useState<PayoutFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'submit' | 'refresh' | null>(null);
  const [editing, setEditing] = useState(view === 'none' || view === 'attention');

  useEffect(() => {
    onboardingApi.payoutRail().then(setRail).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Gateway requirements (needs_clarification) → highlight the matching fields.
    const e: PayoutFieldErrors = {};
    for (const r of payout?.requirements ?? []) {
      const f = requirementField(r.field_reference);
      if (f) e[f] = r.description || 'Please check this field.';
    }
    if (Object.keys(e).length) setErrors(e);
  }, [payout]);

  const set = <K extends keyof PayoutForm>(k: K, v: PayoutForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAddr = (k: keyof NonNullable<PayoutForm['address']>, v: string) =>
    setForm((f) => ({ ...f, address: { street: '', city: '', state: '', postal_code: '', ...f.address, [k]: v } }));

  const submit = async () => {
    const clean: PayoutForm = {
      ...form,
      legal_name: form.legal_name.trim(),
      pan: form.pan.trim().toUpperCase(),
      ifsc: form.ifsc.trim().toUpperCase(),
      email: form.email.trim(),
      account_number: form.account_number.replace(/\s/g, ''),
      confirm_account_number: form.confirm_account_number.replace(/\s/g, ''),
    };
    const e = validatePayoutForm(clean, rail);
    setErrors(e);
    if (Object.keys(e).length) return setError('Please fix the highlighted fields.');
    setBusy('submit');
    setError(null);
    setNotice(null);
    try {
      const res = await onboardingApi.submitPayout(clean);
      if (res.fields) {
        setErrors(res.fields);
        setError(res.error ?? 'Please fix the highlighted fields.');
        return;
      }
      // Never keep bank details in memory longer than needed.
      setForm({ ...EMPTY, legal_name: clean.legal_name });
      setEditing(false);
      if (res.state === 'unavailable') setNotice(res.message ?? "Payouts setup temporarily unavailable — we'll notify you.");
      else toast({ message: 'Details submitted for verification', tone: 'success' });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const r = await onboardingApi.refreshPayout();
      if (r.state === 'unavailable') setNotice(r.message ?? "Payouts setup temporarily unavailable — we'll notify you.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const next = async () => {
    if (mode === 'wizard') await onboardingApi.setStep(6).catch(() => undefined);
    onDone();
  };

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={
        <SectionFooter
          primary={mode === 'wizard' ? (view === 'none' ? 'Do this later' : 'Continue') : 'Done'}
          onPrimary={() => void next()}
          onBack={onBack}
        />
      }
    >
      <Intro title="Payouts & verification" subtitle="We verify your identity with your PAN and bank account through our payment partner (Razorpay). Earnings are paid to this account." />
      <InlineAlert message={error} />
      {notice ? <InlineAlert tone="info" title="Payouts setup temporarily unavailable" message={notice} /> : null}

      <StatusCard view={view} payout={payout} reason={data.state.provider?.kyc_reason ?? null} onRefresh={() => void refresh()} refreshing={busy === 'refresh'} onEdit={() => setEditing(true)} editing={editing} />

      {editing ? (
        <Card gap={t.spacing.lg}>
          <Input
            label="Name as on PAN / bank account"
            value={form.legal_name}
            onChangeText={(v) => set('legal_name', v)}
            error={errors.legal_name}
            autoCapitalize="characters"
            maxLength={100}
            helper="Must match your bank account name"
          />
          <Input label="PAN" value={form.pan} onChangeText={(v) => set('pan', v.toUpperCase())} error={errors.pan} autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" autoComplete="off" />
          <Input label="Email" value={form.email} onChangeText={(v) => set('email', v)} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={120} />
          <Input
            label="Bank account number"
            value={form.account_number}
            onChangeText={(v) => set('account_number', v.replace(/[^\d]/g, ''))}
            error={errors.account_number}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={18}
            autoComplete="off"
          />
          <Input
            label="Re-enter account number"
            value={form.confirm_account_number}
            onChangeText={(v) => set('confirm_account_number', v.replace(/[^\d]/g, ''))}
            error={errors.confirm_account_number}
            keyboardType="number-pad"
            maxLength={18}
            autoComplete="off"
          />
          <Input label="IFSC" value={form.ifsc} onChangeText={(v) => set('ifsc', v.toUpperCase())} error={errors.ifsc} autoCapitalize="characters" maxLength={11} placeholder="SBIN0001234" autoComplete="off" />
          {rail === 'route' ? (
            <>
              <Input label="Address" value={form.address?.street ?? ''} onChangeText={(v) => setAddr('street', v)} error={errors.address} maxLength={200} />
              <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                <Input label="City" value={form.address?.city ?? ''} onChangeText={(v) => setAddr('city', v)} containerStyle={{ flex: 1 }} maxLength={60} />
                <Input label="PIN code" value={form.address?.postal_code ?? ''} onChangeText={(v) => setAddr('postal_code', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} containerStyle={{ flex: 1 }} />
              </View>
              <Input label="State" value={form.address?.state ?? ''} onChangeText={(v) => setAddr('state', v)} maxLength={60} />
            </>
          ) : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
            <Ionicons name="lock-closed-outline" size={16} color={t.colors.muted} style={{ marginTop: 2 }} />
            <Text variant="footnote" color="muted" style={{ flex: 1 }}>
              Your PAN and full account number go straight to Razorpay and are not stored by QuickServe. We keep only the last 4 digits and IFSC to show you where payouts go.
            </Text>
          </View>
          <Button title={view === 'none' ? 'Verify & save' : 'Resubmit details'} size="lg" onPress={() => void submit()} loading={busy === 'submit'} />
        </Card>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text variant="footnote" color="muted">
          Bank checks usually finish within minutes; some take up to 1–2 working days. You can finish the other steps meanwhile.
        </Text>
        <Button
          title="Contact support"
          variant="ghost"
          size="sm"
          leftIcon="help-circle-outline"
          onPress={() => void Linking.openURL(`mailto:${supportContact.email}?subject=${encodeURIComponent('Provider payouts help')}`)}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
    </Screen>
  );
}

function StatusCard(props: {
  view: View_;
  payout: PayoutAccount | null;
  reason: string | null;
  refreshing: boolean;
  editing: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const t = useTheme();
  const { view, payout } = props;
  if (view === 'none') return null;
  const where = payout?.bank_last4 ? `Bank account ••••${payout.bank_last4}${payout.ifsc ? ` · ${payout.ifsc}` : ''}` : null;
  const map: Record<Exclude<View_, 'none'>, { badge: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; body: string }> = {
    unavailable: { badge: 'Temporarily unavailable', tone: 'info', body: "Payouts setup temporarily unavailable — we'll notify you. Your profile and other steps are saved." },
    pending: { badge: 'Verifying', tone: 'warning', body: 'Our payment partner is verifying your details.' },
    verified: { badge: 'Verified', tone: 'success', body: 'Payouts go to this account.' },
    attention: { badge: 'Action needed', tone: 'danger', body: props.reason || 'Your details could not be verified. Check them and resubmit.' },
    rejected: { badge: 'Not verified', tone: 'danger', body: props.reason || 'Verification failed. Contact support.' },
    suspended: { badge: 'Suspended', tone: 'danger', body: props.reason || 'Payouts are on hold. Contact support.' },
  };
  const m = map[view];
  return (
    <Card gap={t.spacing.sm} variant="filled">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="calloutStrong">Payout account</Text>
        <Badge label={m.badge} tone={m.tone} />
      </View>
      {where ? (
        <Text variant="callout" tabular>
          {where}
        </Text>
      ) : null}
      {payout?.beneficiary_name ? (
        <Text variant="footnote" color="muted">
          {payout.beneficiary_name}
        </Text>
      ) : null}
      <Text variant="footnote" color="textSecondary">
        {m.body}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        {view === 'pending' ? <Button title="Check status" size="sm" variant="outline" onPress={props.onRefresh} loading={props.refreshing} /> : null}
        {!props.editing && view === 'unavailable' ? <Button title="Try again" size="sm" variant="outline" onPress={props.onEdit} /> : null}
        {!props.editing && view !== 'unavailable' && view !== 'suspended' ? <Button title="Change account" size="sm" variant="ghost" onPress={props.onEdit} /> : null}
      </View>
    </Card>
  );
}
