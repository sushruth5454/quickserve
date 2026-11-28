import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { getMyCoinBalance, getMyProfile, getMyProvider, isDemoMode, signOut, updateMyProfile } from '../lib/api';
import { amIAdmin } from '../lib/adminApi';
import { useAppFeatureFlags } from '../lib/featureFlags';
import { getCoinsConfig } from '../lib/coinsConfigApi';
import { formatPhone } from '../lib/phone';
import { formatINR } from '../lib/money';
import type { CoinsConfig } from '../lib/coins';
import type { Profile, Provider } from '../lib/types';
import { onboardingApi } from '../lib/onboarding';
import { listMyBusinessMemberships, type BusinessMembership } from '../features/merchantStaff/api';
import { useLanguage, useT, type TranslationKey } from '../i18n';
import { useTheme } from '../theme';
import { ProviderMeSections } from './ProviderMeSections';
import { Avatar, BottomSheet, Button, Card, Divider, Header, InlineAlert, Input, LIST_INSET, ListItem, Screen, Skeleton, Text, useConfirm, useToast } from './ui';

type ReadStatus = 'loading' | 'ready' | 'error';

type ReadState<T> = {
  status: ReadStatus;
  value: T | null;
  error: string | null;
};

type ProviderReadState = ReadState<Provider> & {
  mode: 'customer' | 'provider';
  isLive: boolean | null;
};

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AccountScreen({ mode }: { mode: 'customer' | 'provider' }) {
  const t = useTheme();
  const tr = useT();
  const { language, languagePickerEnabled, setLanguage } = useLanguage();
  const flags = useAppFeatureFlags();
  const toast = useToast();
  const confirm = useConfirm();
  const { session, setActiveRole } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [providerRead, setProviderRead] = useState<ProviderReadState>({
    mode,
    status: 'loading',
    value: null,
    isLive: null,
    error: null,
  });
  const [coinBalanceRead, setCoinBalanceRead] = useState<ReadState<number>>({ status: 'loading', value: null, error: null });
  const [coinsConfigRead, setCoinsConfigRead] = useState<ReadState<CoinsConfig>>({ status: 'loading', value: null, error: null });
  const [adminRead, setAdminRead] = useState<ReadState<boolean>>({ status: 'loading', value: null, error: null });
  const [membershipRead, setMembershipRead] = useState<ReadState<BusinessMembership[]>>({ status: 'loading', value: null, error: null });
  const [languageOptionsVisible, setLanguageOptionsVisible] = useState(false);
  const [nameSheetVisible, setNameSheetVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const providerRequest = useRef(0);
  const coinBalanceRequest = useRef(0);
  const coinsConfigRequest = useRef(0);
  const adminRequest = useRef(0);
  const membershipRequest = useRef(0);
  const merchantStaffEnabled = flags.isOn('merchant_staff');

  const loadProvider = useCallback(async () => {
    const request = ++providerRequest.current;
    setProviderRead({ mode, status: 'loading', value: null, isLive: null, error: null });
    try {
      if (mode === 'provider') {
        const state = await onboardingApi.getOnboarding();
        if (providerRequest.current !== request) return;
        setProviderRead({
          mode,
          status: 'ready',
          value: state.provider,
          isLive: state.go_live.state === 'live',
          error: null,
        });
      } else {
        const value = await getMyProvider();
        if (providerRequest.current !== request) return;
        setProviderRead({ mode, status: 'ready', value, isLive: null, error: null });
      }
    } catch (error) {
      if (providerRequest.current !== request) return;
      setProviderRead({
        mode,
        status: 'error',
        value: null,
        isLive: null,
        error: readError(error, 'Provider status is unavailable.'),
      });
    }
  }, [mode]);

  const loadAdmin = useCallback(async () => {
    const request = ++adminRequest.current;
    setAdminRead({ status: 'loading', value: null, error: null });
    try {
      const value = await amIAdmin();
      if (adminRequest.current !== request) return;
      setAdminRead({ status: 'ready', value, error: null });
    } catch (error) {
      if (adminRequest.current !== request) return;
      setAdminRead({ status: 'error', value: null, error: readError(error, 'Admin status is unavailable.') });
    }
  }, []);

  const loadCoinBalance = useCallback(async () => {
    const request = ++coinBalanceRequest.current;
    setCoinBalanceRead((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const value = await getMyCoinBalance();
      if (coinBalanceRequest.current !== request) return;
      setCoinBalanceRead({ status: 'ready', value, error: null });
    } catch (error) {
      if (coinBalanceRequest.current !== request) return;
      setCoinBalanceRead((current) => ({
        status: 'error',
        value: current.value,
        error: readError(error, 'Coin balance is unavailable.'),
      }));
    }
  }, []);

  const loadCoinsConfig = useCallback(async () => {
    const request = ++coinsConfigRequest.current;
    setCoinsConfigRead((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const value = await getCoinsConfig();
      if (coinsConfigRequest.current !== request) return;
      setCoinsConfigRead({ status: 'ready', value, error: null });
    } catch (error) {
      if (coinsConfigRequest.current !== request) return;
      setCoinsConfigRead((current) => ({
        status: 'error',
        value: current.value,
        error: readError(error, 'Coin availability is unavailable.'),
      }));
    }
  }, []);

  const loadMemberships = useCallback(async () => {
    const request = ++membershipRequest.current;
    if (!merchantStaffEnabled) {
      setMembershipRead({ status: 'ready', value: [], error: null });
      return;
    }
    setMembershipRead({ status: 'loading', value: null, error: null });
    try {
      const value = await listMyBusinessMemberships();
      if (membershipRequest.current !== request) return;
      setMembershipRead({ status: 'ready', value, error: null });
    } catch (error) {
      if (membershipRequest.current !== request) return;
      setMembershipRead({ status: 'error', value: null, error: readError(error, 'Business membership status is unavailable.') });
    }
  }, [merchantStaffEnabled]);

  useFocusEffect(
    useCallback(() => {
      getMyProfile().then(setProfile).catch(() => undefined);
      void loadProvider();
      void loadAdmin();
      void loadMemberships();
      if (mode === 'customer') {
        void loadCoinBalance();
        void loadCoinsConfig();
      } else {
        setCoinBalanceRead({ status: 'ready', value: null, error: null });
        setCoinsConfigRead({ status: 'ready', value: null, error: null });
      }
      return () => {
        providerRequest.current += 1;
        adminRequest.current += 1;
        coinBalanceRequest.current += 1;
        coinsConfigRequest.current += 1;
        membershipRequest.current += 1;
      };
    }, [loadAdmin, loadCoinBalance, loadCoinsConfig, loadMemberships, loadProvider, mode]),
  );

  const name = profile?.full_name || tr('account.nameFallback');
  const currentProviderRead = providerRead.mode === mode
    ? providerRead
    : { mode, status: 'loading' as const, value: null, isLive: null, error: null };
  const provider = currentProviderRead.value;

  const switchRole = () => {
    if (mode === 'customer') {
      if (currentProviderRead.status !== 'ready') return;
      setActiveRole('provider');
      router.replace(provider ? '/dashboard' : '/onboarding');
    } else {
      setActiveRole('customer');
      router.replace('/');
    }
  };

  const logout = async () => {
    const ok = await confirm({
      title: tr('account.logout.confirmTitle'),
      message: tr('account.logout.confirmMessage'),
      confirmLabel: tr('account.logout.confirmAction'),
      icon: 'log-out-outline',
    });
    if (ok) await signOut();
  };

  const editName = () => {
    setNameDraft(profile?.full_name ?? '');
    setNameError(null);
    setNameSheetVisible(true);
  };

  const saveName = async () => {
    const fullName = nameDraft.trim();
    if (!fullName) {
      setNameError('Enter your name.');
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      await updateMyProfile({ full_name: fullName });
      setProfile((current) => current ? { ...current, full_name: fullName } : current);
      setNameSheetVisible(false);
      toast({ message: 'Name updated', tone: 'success' });
    } catch (e) {
      setNameError((e as Error).message);
    } finally {
      setNameSaving(false);
    }
  };

  const help = () => router.push('/support');

  const soon = (message: TranslationKey) => toast({ message: tr(message), tone: 'default' });
  const notifications = () => Linking.openSettings().catch(() => toast({ message: tr('account.notifications.settingsHint') }));
  const openInfo = (topic: 'safety' | 'terms' | 'privacy') => router.push({ pathname: '/info/[topic]', params: { topic } });
  const chooseLanguage = (next: 'en' | 'te') => {
    setLanguageOptionsVisible(false);
    void setLanguage(next).then(
      () => toast({ message: tr('account.language.saved'), tone: 'success' }),
      () => toast({ message: tr('account.language.syncFailed'), tone: 'warning' }),
    );
  };

  return (
    <Screen inTabs header={<Header title={tr('account.header')} large back={false} />} gap={t.spacing.section}>
      <Card padding={0} gap={0}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('account.profile.accessibility', {
            name,
            phone: formatPhone(session?.phone) || tr('account.phoneVerified.accessibility'),
          })}
          accessibilityHint={mode === 'customer' ? 'Edit your name' : 'Edit your provider profile'}
          onPress={() => mode === 'provider'
            ? router.push({ pathname: '/provider-profile/[section]', params: { section: 'basics', returnTo: 'hub' } })
            : editName()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.lg,
            padding: t.spacing.lg,
            borderRadius: t.radii.lg,
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
          })}
        >
          <Avatar name={name} uri={profile?.avatar_url} size={56} verified={mode === 'provider' && currentProviderRead.isLive === true} />
          <View style={{ flex: 1, gap: 2 }}>
            {profile ? (
              <Text variant="title2" numberOfLines={1}>
                {name}
              </Text>
            ) : (
              <Skeleton width={160} height={22} />
            )}
            <Text variant="callout" color="muted" numberOfLines={1}>
              {formatPhone(session?.phone) || tr('account.phoneVerified')}
            </Text>
          </View>
          {mode === 'provider' ? <Ionicons name="chevron-forward" size={18} color={t.colors.subtle} /> : null}
        </Pressable>
      </Card>

      {currentProviderRead.status === 'loading' ? (
        <Text variant="footnote" color="muted">Checking provider status…</Text>
      ) : null}
      {currentProviderRead.status === 'error' ? (
        <Card gap={t.spacing.sm}>
          <Text variant="calloutStrong">Provider status unavailable</Text>
          <Text variant="footnote" color="muted">{currentProviderRead.error}</Text>
          <Button title="Retry provider status" variant="outline" onPress={() => void loadProvider()} />
        </Card>
      ) : null}

      {mode === 'provider' ? (
        <Group title={tr('account.group.work')}>
          <ListItem icon="id-card-outline" title={tr('account.providerProfile.title')} subtitle={tr('account.providerProfile.subtitle')} chevron onPress={() => router.push('/provider-profile')} />
          <Divider inset={LIST_INSET} />
          <ListItem icon="people-outline" title={tr('account.businessTools.title')} subtitle={tr('account.businessTools.subtitle')} chevron onPress={() => router.push('/business-tools')} />
          <Divider inset={LIST_INSET} />
          <ListItem icon="swap-horizontal" title={tr('account.switchToCustomer.title')} subtitle={tr('account.switchToCustomer.subtitle')} chevron onPress={switchRole} />
        </Group>
      ) : (
        <Group title={tr('account.group.mode')}>
          <ListItem
            icon="swap-horizontal"
            title={tr('account.switchToProvider.title')}
            subtitle={currentProviderRead.status === 'error'
              ? 'Provider status unavailable'
              : currentProviderRead.status === 'loading'
                ? 'Checking provider status…'
                : provider
                  ? tr('account.switchToProvider.manageJobs')
                  : tr('account.switchToProvider.offerServices')}
            chevron
            onPress={switchRole}
          />
        </Group>
      )}

      {flags.isOn('sports') || flags.isOn('products') ? (
        <Group title={tr('account.group.marketplace')}>
          {flags.isOn('sports') ? (
            <ListItem
              icon="football-outline"
              title={tr('account.myVenues.title')}
              subtitle={tr('account.myVenues.subtitle')}
              chevron
              onPress={() => router.push('/sports/manage')}
            />
          ) : null}
          {flags.isOn('sports') && flags.isOn('products') ? <Divider inset={LIST_INSET} /> : null}
          {flags.isOn('products') ? (
            <ListItem
              icon="storefront-outline"
              title={tr('account.myShop.title')}
              subtitle={tr('account.myShop.subtitle')}
              chevron
              onPress={() => router.push('/merchant-shop')}
            />
          ) : null}
          {flags.isOn('products') && flags.isOn('product_rfq') ? (
            <>
              <Divider inset={LIST_INSET} />
              <ListItem
                icon="document-text-outline"
                title="Supplier RFQs"
                subtitle="Review requests and send quotes"
                chevron
                onPress={() => router.push('/merchant-rfqs')}
              />
            </>
          ) : null}
        </Group>
      ) : null}

      {mode === 'provider' && provider ? <ProviderMeSections provider={provider} /> : null}

      {merchantStaffEnabled && membershipRead.status === 'ready' && (membershipRead.value?.length ?? 0) > 0 ? (
        <Group title="Business work">
          <ListItem
            icon="briefcase-outline"
            title="Business work"
            subtitle={`${membershipRead.value?.length ?? 0} business${membershipRead.value?.length === 1 ? '' : 'es'}`}
            chevron
            onPress={() => router.push('/merchant-work')}
          />
        </Group>
      ) : null}
      {merchantStaffEnabled && membershipRead.status === 'loading' ? (
        <Group title="Access status">
          <View style={{ padding: t.spacing.lg }}>
            <Text variant="footnote" color="muted">Checking business memberships…</Text>
          </View>
        </Group>
      ) : null}
      {merchantStaffEnabled && membershipRead.status === 'error' ? (
        <Group title="Access status">
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            <Text variant="footnote" color="muted">{membershipRead.error}</Text>
            <Button title="Retry business memberships" variant="outline" onPress={() => void loadMemberships()} />
          </View>
        </Group>
      ) : null}

      {adminRead.status === 'ready' && adminRead.value ? (
        <Group title={tr('account.group.administration')}>
          <ListItem
            icon="settings-outline"
            title={tr('account.adminPortal.title')}
            subtitle={tr('account.adminPortal.subtitle')}
            chevron
            onPress={() => router.push({ pathname: '/admin', params: { returnTo: mode === 'provider' ? 'pro-account' : 'account' } })}
          />
        </Group>
      ) : null}
      {adminRead.status === 'loading' ? <Skeleton width="50%" height={14} /> : null}
      {adminRead.status === 'error' ? (
        <Group title={tr('account.group.administration')}>
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            <Text variant="footnote" color="muted">{adminRead.error}</Text>
            <Button title="Retry admin status" variant="outline" onPress={() => void loadAdmin()} />
          </View>
        </Group>
      ) : null}

      <Group title={tr('account.group.account')}>
        {mode === 'customer' ? (
          <>
            <ListItem
              icon="sparkles-outline"
              title={tr('account.coins.title')}
              subtitle={
                coinsConfigRead.value === null
                  ? coinsConfigRead.status === 'error'
                    ? tr('account.coins.policyUnavailable')
                    : 'Checking reward availability…'
                  : coinsConfigRead.value.coins_earning_enabled === false && coinsConfigRead.value.coins_redemption_enabled === false
                      ? 'Rewards are paused. Your coin history remains available.'
                      : tr('account.coins.subtitle', {
                          coins: '100',
                          value: formatINR(100 * coinsConfigRead.value.coin_paise),
                          months: String(coinsConfigRead.value.expiry_months),
                        })
              }
              value={coinBalanceRead.value === null
                ? coinBalanceRead.status === 'loading' ? 'Loading…' : 'Unavailable'
                : formatINR(coinBalanceRead.value)}
              chevron
              onPress={() => router.push('/coins')}
            />
            {coinBalanceRead.status === 'error' || coinsConfigRead.status === 'error' ? (
              <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.md, gap: t.spacing.sm }}>
                <Text variant="footnote" color="muted">
                  {[coinBalanceRead.error, coinsConfigRead.error].filter(Boolean).join(' ')}
                </Text>
                <Button
                  title="Retry coin details"
                  variant="outline"
                  onPress={() => {
                    void loadCoinBalance();
                    void loadCoinsConfig();
                  }}
                />
              </View>
            ) : null}
            <Divider inset={LIST_INSET} />
            <ListItem icon="location-outline" title={tr('account.savedAddresses.title')} subtitle={tr('account.savedAddresses.subtitle')} chevron onPress={() => router.push('/location')} />
            <Divider inset={LIST_INSET} />
            <ListItem icon="card-outline" title={tr('account.paymentMethods.title')} subtitle={tr('account.paymentMethods.subtitle')} chevron onPress={() => soon('account.paymentMethods.comingSoon')} />
            <Divider inset={LIST_INSET} />
          </>
        ) : null}
        <ListItem icon="notifications-outline" title={tr('account.notifications.title')} chevron onPress={() => void notifications()} />
        <Divider inset={LIST_INSET} />
        {languagePickerEnabled ? (
          <>
            <ListItem
              icon="language-outline"
              title={tr('account.language.title')}
              value={tr(language === 'te' ? 'language.telugu' : 'language.english')}
              chevron
              onPress={() => setLanguageOptionsVisible((visible) => !visible)}
            />
            {languageOptionsVisible ? (
              <>
                <Divider inset={LIST_INSET} />
                <ListItem
                  icon={language === 'en' ? 'checkmark-circle-outline' : 'radio-button-off-outline'}
                  title={tr('language.english')}
                  onPress={() => chooseLanguage('en')}
                />
                <Divider inset={LIST_INSET} />
                <ListItem
                  icon={language === 'te' ? 'checkmark-circle-outline' : 'radio-button-off-outline'}
                  title={tr('language.telugu')}
                  onPress={() => chooseLanguage('te')}
                />
              </>
            ) : null}
            <Divider inset={LIST_INSET} />
          </>
        ) : null}
        <ListItem icon="lock-closed-outline" title={tr('account.privacy.title')} subtitle={tr('account.privacy.subtitle')} chevron onPress={() => openInfo('privacy')} />
      </Group>

      <Group title={tr('account.group.support')}>
        <ListItem icon="help-buoy-outline" title={tr('account.support.title')} subtitle={tr('account.support.subtitle')} chevron onPress={help} />
        <Divider inset={LIST_INSET} />
        <ListItem icon="shield-checkmark-outline" title={tr('account.safety.title')} chevron onPress={() => openInfo('safety')} />
        <Divider inset={LIST_INSET} />
        <ListItem icon="document-text-outline" title={tr('account.terms.title')} chevron onPress={() => openInfo('terms')} />
      </Group>

      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        <ListItem icon="log-out-outline" title={tr('account.logout.title')} onPress={() => void logout()} />
      </Card>

      <Text variant="caption" color="muted" align="center">
        QuickServe {Constants.expoConfig?.version ?? '1.0.0'}
        {isDemoMode ? ` · ${tr('account.demoMode')}` : ''}
      </Text>

      <BottomSheet
        visible={nameSheetVisible}
        onClose={() => setNameSheetVisible(false)}
        title="Edit name"
        footer={<Button title="Save" onPress={() => void saveName()} loading={nameSaving} disabled={!nameDraft.trim()} size="lg" fullWidth />}
      >
        <Input label="Your name" value={nameDraft} onChangeText={setNameDraft} autoComplete="name" />
        <InlineAlert message={nameError} />
      </BottomSheet>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="overline" color="muted" style={{ paddingHorizontal: t.spacing.lg }} accessibilityRole="header">
        {title}
      </Text>
      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        {children}
      </Card>
    </View>
  );
}
