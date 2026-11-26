import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Linking, View } from 'react-native';
import { Button, Card, Header, Screen, Text, useConfirm, useToast } from '../../components/ui';
import { supportContact } from '../../lib/config';
import { requestAccountDeletion } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme';

type Topic = 'safety' | 'terms' | 'privacy' | 'help';

const CONTENT: Record<Topic, { title: string; intro: string; points: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] }> = {
  safety: {
    title: 'Safety & booking details',
    intro: 'Review the protections and support details shown for your booking.',
    points: [
      { icon: 'shield-checkmark-outline', title: 'Provider details', body: 'Review the provider details shown for your booking.' },
      { icon: 'key-outline', title: 'Booking steps', body: 'Follow any start or completion code instructions shown for your booking.' },
      { icon: 'receipt-outline', title: 'Quotes and proposals', body: 'For jobs that require an itemized quote, work starts only after the quote is approved. Fixed-price and proposal work follows the accepted package or proposal and its payment schedule.' },
      { icon: 'lock-closed-outline', title: 'Payment and payout', body: 'Review the payment and payout details shown for your booking, including any 24-hour release timing.' },
      { icon: 'flag-outline', title: 'Support', body: 'Use the support options available in the app.' },
    ],
  },
  terms: {
    title: 'Terms & privacy policy',
    intro: 'A plain-language summary. The full documents are available from support@quickserve.app.',
    points: [
      { icon: 'document-text-outline', title: 'Using QuickServe', body: 'QuickServe connects you with independent service providers. Providers set their own visit fee and rates.' },
      { icon: 'cash-outline', title: 'Fees', body: 'A one-time platform fee is added to the final bill. The visit fee is adjusted in the final bill.' },
      { icon: 'return-down-back-outline', title: 'Cancellations & refunds', body: 'Cancel for free until a pro accepts. Refunds go back to your original payment method.' },
      { icon: 'eye-off-outline', title: 'Your data', body: 'We use your phone number to sign you in and your location to find nearby pros. Numbers are never shown to the other party.' },
    ],
  },
  privacy: {
    title: 'Privacy & data',
    intro: 'Review the privacy information and account actions available on this screen.',
    points: [
      { icon: 'call-outline', title: 'Private numbers', body: 'Chat happens in the app; your phone number is never shared.' },
      { icon: 'location-outline', title: 'Location', body: 'Used only to find nearby pros and to share your address with the pro you booked.' },
      { icon: 'download-outline', title: 'Get a copy', body: 'Email support@quickserve.app to receive a copy of your data.' },
    ],
  },
  help: {
    title: 'Sign-in help',
    intro: 'If you cannot receive a verification code or have changed your number, contact support for account-access help.',
    points: [
      { icon: 'key-outline', title: 'Changed your number?', body: 'Explain that you can no longer receive codes and ask support for next steps. Never share your one-time verification code.' },
    ],
  },
};

export default function InfoDetailScreen() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { session } = useAuth();
  const { topic } = useLocalSearchParams<{ topic: string }>();
  const key: Topic = topic === 'terms' || topic === 'privacy' || topic === 'help' ? topic : 'safety';
  const c = CONTENT[key];

  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Request account deletion?',
      message:
        'Submitting a request does not erase your account immediately. Any recorded request remains pending until processed. If your email app opens, send the message to submit your request.',
      confirmLabel: 'Request deletion',
      destructive: true,
      icon: 'trash-outline',
    });
    if (!ok) return;
    try {
      const outcome = await requestAccountDeletion();
      toast({
        message: outcome === 'recorded'
          ? 'Deletion request recorded; processing is pending. We’ll confirm within 30 days.'
          : 'Your email app is open. Send the message to submit your deletion request.',
        tone: 'success',
      });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  return (
    <Screen header={<Header title={c.title} />} gap={t.spacing.xl}>
      <Text variant="body" color="textSecondary">
        {c.intro}
      </Text>
      <Card gap={t.spacing.lg}>
        {c.points.map((p) => (
          <View key={p.title} style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <View
              style={{ width: 32, height: 32, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={p.icon} size={18} color={t.colors.textSecondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="calloutStrong">{p.title}</Text>
              <Text variant="footnote" color="muted">
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </Card>
      {key === 'help' ? (
        <View style={{ gap: t.spacing.sm }}>
          <Button
            title={`Email ${supportContact.email}`}
            variant="outline"
            leftIcon="mail-outline"
            onPress={() => void Linking.openURL(`mailto:${supportContact.email}?subject=${encodeURIComponent('Sign-in help')}`).catch(() =>
              toast({ message: 'Could not open your email app.', tone: 'error' }),
            )}
          />
          {supportContact.phone ? (
            <Button
              title="Call support"
              variant="outline"
              leftIcon="call-outline"
              onPress={() => void Linking.openURL(`tel:${supportContact.phone}`).catch(() =>
                toast({ message: 'Could not start a call.', tone: 'error' }),
              )}
            />
          ) : null}
          {supportContact.whatsapp ? (
            <Button
              title="Message support on WhatsApp"
              variant="outline"
              leftIcon="chatbubble-outline"
              onPress={() => void Linking.openURL(`https://wa.me/${supportContact.whatsapp}`).catch(() =>
                toast({ message: 'Could not open WhatsApp.', tone: 'error' }),
              )}
            />
          ) : null}
        </View>
      ) : null}
      {key === 'privacy' && session ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="overline" color="muted" style={{ paddingHorizontal: t.spacing.lg }}>
            Danger zone
          </Text>
          <Card gap={t.spacing.md}>
            <View style={{ gap: 2 }}>
              <Text variant="calloutStrong">Request account deletion</Text>
              <Text variant="footnote" color="muted">
                Any recorded request remains pending until processed; submitting a request does not erase your account immediately.
              </Text>
            </View>
            <Button title="Request account deletion" variant="destructiveGhost" leftIcon="trash-outline" onPress={() => void deleteAccount()} style={{ alignSelf: 'flex-start' }} />
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
