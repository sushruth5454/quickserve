import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Linking, View } from 'react-native';
import { Button, Card, Header, Screen, Text, useConfirm, useToast } from '../../src/components/ui';
import { supportContact } from '../../src/lib/config';
import { requestAccountDeletion } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useTheme } from '../../src/theme';

type Topic = 'safety' | 'terms' | 'privacy' | 'help';

const CONTENT: Record<Topic, { title: string; intro: string; points: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] }> = {
  safety: {
    title: 'Safety & guarantee',
    intro: 'Every booking on QuickServe is protected from request to payout.',
    points: [
      { icon: 'shield-checkmark-outline', title: 'Verified pros', body: 'Providers complete KYC with our payment partner before they appear in search.' },
      { icon: 'key-outline', title: 'Code-protected visits', body: 'Work only starts after you share a one-time start code at your door, and closes with a completion code.' },
      { icon: 'receipt-outline', title: 'Quote before work', body: 'You approve an itemised quote before any work begins. No surprise bills.' },
      { icon: 'lock-closed-outline', title: 'Money held safely', body: 'Payments are held by QuickServe and released to the pro 24 hours after completion.' },
      { icon: 'flag-outline', title: 'Report a problem', body: 'Raise a dispute from the booking and the payout is paused while support reviews it.' },
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
    intro: 'You control your data. Phone numbers stay private between customers and pros.',
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

export default function InfoScreen() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { session } = useAuth();
  const { topic } = useLocalSearchParams<{ topic: string }>();
  const key: Topic = topic === 'terms' || topic === 'privacy' || topic === 'help' ? topic : 'safety';
  const c = CONTENT[key];

  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      message:
        'We will permanently delete your profile, addresses and chat history. Booking and payment records we must keep by law are anonymised. Open bookings must be finished or cancelled first.',
      confirmLabel: 'Request deletion',
      destructive: true,
      icon: 'trash-outline',
    });
    if (!ok) return;
    try {
      const outcome = await requestAccountDeletion();
      toast({
        message: outcome === 'recorded'
          ? 'Deletion requested. We’ll confirm within 30 days.'
          : 'Your email app is open. Send the message to complete your deletion request.',
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
              <Text variant="calloutStrong">Delete account</Text>
              <Text variant="footnote" color="muted">
                Permanently delete your account and personal data.
              </Text>
            </View>
            <Button title="Delete account" variant="destructiveGhost" leftIcon="trash-outline" onPress={() => void deleteAccount()} style={{ alignSelf: 'flex-start' }} />
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
