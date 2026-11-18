import { Linking, Pressable, View } from 'react-native';
import { Header, Screen, Text } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

export default function SignInHelpScreen() {
  const t = useTheme();

  return (
    <Screen header={<Header title="Sign-in help" />} gap={t.spacing.lg}>
      <Text variant="body" color="textSecondary">
        If you cannot receive a verification code or have changed your number, contact support for account-access help.
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL('mailto:support@quickserve.app?subject=Sign-in%20help').catch(() => undefined)}
        style={({ pressed }) => ({ paddingVertical: t.spacing.sm, opacity: pressed ? 0.7 : 1 })}
      >
        <Text variant="bodyStrong" color="primaryText">
          support@quickserve.app
        </Text>
      </Pressable>
      <View>
        <Text variant="footnote" color="muted">
          Please do not include your one-time verification code in your message.
        </Text>
      </View>
    </Screen>
  );
}
