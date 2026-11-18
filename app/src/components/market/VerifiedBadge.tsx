import type { JSX } from 'react';
import { useT } from '../../i18n';
import { Badge } from '../ui/Badge';

export function VerifiedBadge(): JSX.Element {
  const t = useT();
  return <Badge tone="success" icon="shield-checkmark" label={t('badge.verified')} />;
}
