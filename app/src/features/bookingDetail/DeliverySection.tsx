import { View } from 'react-native';
import { BottomSheet, Button, Card, ListItem, Section, Text, TextArea } from '../../components/ui';
import type { DeliveryLink } from '../../lib/types';
import type { useTheme } from '../../theme';
import { fmt } from './model';

type Theme = ReturnType<typeof useTheme>;

type DeliverySectionPlacement =
  | {
      placement: 'request';
      theme: Theme;
      revisionsLeft: number;
      busy: boolean;
      onOpen: () => void;
    }
  | {
      placement: 'revision';
      theme: Theme;
      revisionsUsed: number;
      revisionsAllowed: number;
      note: string;
    }
  | {
      placement: 'sheet';
      theme: Theme;
      visible: boolean;
      revisionsLeft: number;
      revisionNote: string;
      busy: boolean;
      onClose: () => void;
      onChangeNote: (value: string) => void;
      onSubmit: () => void;
    }
  | {
      placement: 'delivered';
      links: DeliveryLink[];
      submittedAt: string | null;
      onOpenLink: (url: string) => void;
    }
  | {
      placement: 'payment-default';
      busy: boolean;
      onPress: () => void;
    };

type DeliverySectionProps = DeliverySectionPlacement;

export function DeliverySection(props: DeliverySectionProps) {
  if (props.placement === 'request') {
    return (
      <Button
        title={`Request changes (${props.revisionsLeft} left)`}
        leftIcon="create-outline"
        variant="outline"
        disabled={props.busy}
        onPress={props.onOpen}
      />
    );
  }

  if (props.placement === 'revision') {
    const t = props.theme;
    return (
      <Card gap={t.spacing.sm}>
        <Text variant="subheadStrong">Revision requested</Text>
        <Text variant="footnote" color="muted">{`Revision ${props.revisionsUsed} of ${props.revisionsAllowed}`}</Text>
        <Text variant="callout">{props.note || 'Revision note unavailable. Refresh the booking to try again.'}</Text>
      </Card>
    );
  }

  if (props.placement === 'delivered') {
    return (
      <Section title="Delivered work">
        <Card padding={0} gap={0}>
          {props.links.map((link, index) => {
            let host = link.url;
            try {
              host = new URL(link.url).host;
            } catch {
              // Older rows may not contain a valid URL.
            }
            return (
              <ListItem
                key={`${link.url}-${index}`}
                title={link.title || host}
                subtitle={host}
                chevron
                onPress={() => props.onOpenLink(link.url)}
              />
            );
          })}
          {props.submittedAt ? (
            <Text variant="footnote" color="muted">
              Submitted {fmt(props.submittedAt)}
            </Text>
          ) : null}
        </Card>
      </Section>
    );
  }

  if (props.placement === 'payment-default') {
    return (
      <Button
        title="Customer has not paid — close and get paid"
        variant="destructive"
        disabled={props.busy}
        loading={props.busy}
        onPress={props.onPress}
      />
    );
  }

  const t = props.theme;
  const { visible, revisionsLeft, revisionNote, busy, onClose, onChangeNote, onSubmit } = props;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Request changes"
      subtitle={`${revisionsLeft} revision${revisionsLeft === 1 ? '' : 's'} left`}
      footer={
        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          <Button title="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title="Send request"
            disabled={revisionNote.trim().length < 5 || revisionNote.trim().length > 1000}
            loading={busy}
            onPress={onSubmit}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <TextArea
        label="What would you like changed?"
        placeholder="Describe the changes you need"
        value={revisionNote}
        onChangeText={onChangeNote}
        maxLength={1000}
      />
      <Text variant="footnote" color="muted">Please include at least 5 characters.</Text>
    </BottomSheet>
  );
}
