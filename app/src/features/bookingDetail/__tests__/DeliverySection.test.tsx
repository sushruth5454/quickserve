import React from 'react';
import { Button, Card, ListItem, Section, Text } from '../../../components/ui';
import { DeliverySection } from '../DeliverySection';
import type { useTheme } from '../../../theme';

jest.mock('../../../components/ui', () => ({
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  ListItem: 'ListItem',
  Section: 'Section',
  Text: 'Text',
  TextArea: 'TextArea',
}));
jest.mock('react-native', () => ({ View: 'View' }));

const theme = {
  spacing: { sm: 8, md: 12, lg: 16 },
  radii: { sm: 4, md: 8, lg: 12 },
} as unknown as ReturnType<typeof useTheme>;

describe('booking delivery section', () => {
  it('renders each delivered link and the submission time', () => {
    const section = DeliverySection({
      placement: 'delivered',
      theme,
      links: [
        { title: 'Final edit', url: 'https://files.example.test/final-edit' },
        { title: 'Raw footage', url: 'https://files.example.test/raw-footage' },
      ],
      submittedAt: '2026-11-18T12:00:00.000Z',
      onOpenLink: jest.fn(),
    });

    const sectionElement = section as React.ReactElement<{ title: string; children: React.ReactNode }>;
    expect(sectionElement.type).toBe(Section);
    expect(sectionElement.props.title).toBe('Delivered work');
    const card = React.Children.only(sectionElement.props.children) as React.ReactElement<{ children: React.ReactNode }>;
    expect(card.type).toBe(Card);
    const rows = React.Children.toArray(card.props.children) as React.ReactElement<{
      title?: string;
      subtitle?: string;
      children?: React.ReactNode;
    }>[];
    expect([rows[0]?.props.title, rows[1]?.props.title]).toEqual(['Final edit', 'Raw footage']);
    expect([rows[0]?.props.subtitle, rows[1]?.props.subtitle]).toEqual([
      'files.example.test',
      'files.example.test',
    ]);
    const submittedRow = rows[2];
    expect(submittedRow?.type).toBe(Text);
    const submittedCopy = React.Children.toArray(submittedRow?.props.children);
    expect(submittedCopy[0]?.toString()).toBe('Submitted ');
    expect(typeof submittedCopy[1]).toBe('string');
  });

  it('opens the selected delivered link', () => {
    const onOpenLink = jest.fn();
    const section = DeliverySection({
      placement: 'delivered',
      theme,
      links: [{ title: 'Final edit', url: 'https://files.example.test/final-edit' }],
      submittedAt: null,
      onOpenLink,
    });
    const sectionElement = section as React.ReactElement<{ children: React.ReactNode }>;
    const card = React.Children.only(sectionElement.props.children) as React.ReactElement<{ children: React.ReactNode }>;
    const row = React.Children.toArray(card.props.children)[0] as React.ReactElement<{
      onPress?: () => void;
    }>;

    expect(row.type).toBe(ListItem);
    row.props.onPress?.();
    expect(onOpenLink).toHaveBeenCalledWith('https://files.example.test/final-edit');
  });

  it('shows the provider payment-default action only when the caller says it is eligible', () => {
    const onPress = jest.fn();
    const action = DeliverySection({
      placement: 'payment-default',
      theme,
      busy: false,
      onPress,
    });
    const button = action as React.ReactElement<{
      title?: string;
      onPress?: () => void;
    }>;

    expect(button.type).toBe(Button);
    expect(button.props.title).toBe('Customer has not paid — close and get paid');
    button.props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
