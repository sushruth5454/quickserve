import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { Card, Divider, LIST_INSET, ListItem, Section } from '../../components/ui';

export interface HelpItem {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  subtitle?: string;
  onPress: () => void;
}

export function CancelSection({ items, busy }: { items: HelpItem[]; busy: boolean }) {
  return (
    <Section title="Help">
      <Card padding={0} gap={0}>
        {items.map((h, i) => (
          <Fragment key={h.key}>
            {i > 0 ? <Divider inset={LIST_INSET} /> : null}
            <ListItem title={h.title} subtitle={h.subtitle} icon={h.icon} destructive={h.destructive} chevron={!h.destructive} onPress={busy ? undefined : h.onPress} />
          </Fragment>
        ))}
      </Card>
    </Section>
  );
}
