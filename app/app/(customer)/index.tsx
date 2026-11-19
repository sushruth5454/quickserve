import { HomeV2 } from '../../src/features/home/HomeV2';
import { LegacyHome } from '../../src/features/home/LegacyHome';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { homeFeatureState } from '../../src/features/home/homeModel';

export default function CustomerHome() {
  const flags = useAppFeatureFlags();
  const { homeV2 } = homeFeatureState(flags);
  return homeV2 ? <HomeV2 flags={flags} /> : <LegacyHome flags={flags} />;
}
