import { GuestGate } from '../../src/components/GuestGate';
import { AccountScreen } from '../../src/components/AccountScreen';

export default function CustomerAccount() {
  return (
    <GuestGate returnTo="/account">
      <AccountScreen mode="customer" />
    </GuestGate>
  );
}
