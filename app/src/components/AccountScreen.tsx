import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { getMyCoinBalance, getMyProfile, getMyProvider, isDemoMode, signOut } from '../lib/api';
import { amIAdmin } from '../lib/adminApi';
import { useAppFeatureFlags } from '../lib/featureFlags';
import { getCoinsConfig } from '../lib/coinsConfigApi';
import { formatPhone } from '../lib/phone';
import { formatINR } from '../lib/money';
import type { CoinsConfig } from '../lib/coins';
import type { Profile, Provider } from '../lib/types';
import { useLanguage, useT, type TranslationKey } from '../i18n';
import { useTheme } from '../theme';
import { ProviderMeSections } from './ProviderMeSections';
import { Avatar, Card, Divider, Header, LIST_INSET, ListItem, Screen, Skeleton, Text, useConfirm, useToast } from './ui';

export function AccountScreen({ mode }: { mode: 'customer' | 'provider' }) {
  const t = useTheme();
  const tr = useT();
  const { language, languagePickerEnabled, setLanguage } = useLanguage();
  const flags = useAppFeatureFlags();
  const toast = useToast();
  const confirm = useConfirm();
  const { session, setActiveRole } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<Provider | null | undefined>(undefined);
  const [coinBalance, setCoinBalance] = useState(0);
  const [coinsConfig, setCoinsConfig] = useState<CoinsConfig | null>(null);
  const [coinsPolicyUnavailable, setCoinsPolicyUnavailable] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [languageOptionsVisible, setLanguageOptionsVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getMyProfile().then(setProfile).catch(() => undefined);
      getMyProvider().then(setProvider).catch(() => setProvider(null));
      amIAdmin().then(setAdmin).catch(() => setAdmin(false));
      if (mode === 'customer') {
        getMyCoinBalance().then(setCoinBalance).catch(() => setCoinBalance(0));
        getCoinsConfig()
          .then((config) => {
            setCoinsConfig(config);
            setCoinsPolicyUnavailable(false);
          })
          .catch(() => {
            setCoinsConfig(null);
            setCoinsPolicyUnavailable(true);
          });
      } else {
        setCoinsConfig(null);
        setCoinsPolicyUnavailable(false);
      }
    }, [mode]),
  );

  const name = profile?.full_name || tr('account.nameFallback');

  const switchRole = () => {
    if (mode === 'customer') {
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
          accessibilityRole={mode === 'provider' ? 'button' : undefined}
          accessibilityLabel={tr('account.profile.accessibility', {
            name,
            phone: formatPhone(session?.phone) || tr('account.phoneVerified.accessibility'),
          })}
          disabled={mode !== 'provider'}
          onPress={() => router.push('/onboarding')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.lg,
            padding: t.spacing.lg,
            borderRadius: t.radii.lg,
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
          })}
        >
          <Avatar name={name} uri={profile?.avatar_url} size={56} verified={mode === 'provider' && provider?.kyc_status === 'verified'} />
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
            subtitle={provider ? tr('account.switchToProvider.manageJobs') : tr('account.switchToProvider.offerServices')}
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

      {admin ? (
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

      <Group title={tr('account.group.account')}>
        {mode === 'customer' ? (
          <>
            {coinsConfig?.coins_earning_enabled === false && coinsConfig.coins_redemption_enabled === false ? null : (
              <>
                <ListItem
                  icon="sparkles-outline"
                  title={tr('account.coins.title')}
                  subtitle={
                    coinsPolicyUnavailable
                      ? tr('account.coins.policyUnavailable')
                      : coinsConfig
                        ? tr('account.coins.subtitle', {
                            coins: '100',
                            value: formatINR(100 * coinsConfig.coin_paise),
                            months: String(coinsConfig.expiry_months),
                          })
                        : tr('account.coins.subtitleFallback')
                  }
                  value={formatINR(coinBalance)}
                  chevron
                  onPress={() => router.push('/coins')}
                />
                <Divider inset={LIST_INSET} />
              </>
            )}
            <ListItem icon="location-outline" title={tr('account.savedAddresses.title')} subtitle={tr('account.savedAddresses.subtitle')} chevron onPress={() => soon('account.savedAddresses.comingSoon')} />
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
