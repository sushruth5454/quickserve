import React from 'react';
import { Card, ListItem, Section, Text } from '../../../components/ui';
import { DeliverySection } from '../DeliverySection';
import type { useTheme } from '../../../theme';

const theme = {
  spacing: { sm: 8, md: 12, lg: 16 },
  radii: { sm: 4, md: 8, lg: 12 },
} as ReturnType<typeof useTheme>;

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
    expect(rows.slice(0, 2).map((row) => row.props.title)).toEqual(['Final edit', 'Raw footage']);
    expect(rows.slice(0, 2).map((row) => row.props.subtitle)).toEqual([
      'files.example.test',
      'files.example.test',
    ]);
    expect(rows[2].type).toBe(Text);
    expect(rows[2].props.children).toEqual(expect.stringMatching(/^Submitted /));
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
});
