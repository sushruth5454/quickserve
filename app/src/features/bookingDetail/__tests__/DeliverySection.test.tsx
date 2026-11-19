import React from 'react';
import { Button, Card, ListItem, Section, Text } from '../../../components/ui';
import { DeliverySection } from '../DeliverySection';

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

describe('booking delivery section', () => {
  it('renders each delivered link and the submission time', () => {
    const section = DeliverySection({
      placement: 'delivered',
      links: [
        { title: 'Final edit', url: 'https://files.example.test/final-edit' },
        { title: 'Raw footage', url: 'https://files.example.test/raw-footage' },
      ],
      submittedAt: '2026-11-18T12:00:00.000Z',
      onOpenLink: jest.fn(),
    });

    if (!React.isValidElement<{ title: string; children: React.ReactNode }>(section)) {
      throw new Error(`expected a delivered section element; actual=${JSON.stringify(section)}`);
    }
    const sectionElement = section;
    expect(sectionElement.type).toBe(Section);
    expect(sectionElement.props.title).toBe('Delivered work');
    const cardChild = React.Children.only(sectionElement.props.children);
    if (!React.isValidElement<{ children: React.ReactNode }>(cardChild)) {
      throw new Error(`expected a delivery card element; actual=${JSON.stringify(cardChild)}`);
    }
    const card = cardChild;
    expect(card.type).toBe(Card);
    const rows = React.Children.toArray(card.props.children);
    const [first, second, submitted] = rows;
    if (!React.isValidElement<{ title: string; subtitle: string }>(first)
      || !React.isValidElement<{ title: string; subtitle: string }>(second)) {
      throw new Error(`expected two delivered-link rows; actual=${JSON.stringify(rows)}`);
    }
    if (!React.isValidElement<{ children: React.ReactNode }>(submitted)) {
      throw new Error(`expected a submission-time label; actual=${JSON.stringify(rows)}`);
    }
    expect([first.props.title, second.props.title]).toEqual(['Final edit', 'Raw footage']);
    expect([first.props.subtitle, second.props.subtitle]).toEqual([
      'files.example.test',
      'files.example.test',
    ]);
    expect(submitted.type).toBe(Text);
    const submittedCopy = React.Children.toArray(submitted.props.children);
    const [submittedPrefix, submittedTimestamp] = submittedCopy;
    expect(submittedPrefix).toBe('Submitted ');
    expect(typeof submittedTimestamp).toBe('string');
  });

  it('opens the selected delivered link', () => {
    const onOpenLink = jest.fn();
    const section = DeliverySection({
      placement: 'delivered',
      links: [{ title: 'Final edit', url: 'https://files.example.test/final-edit' }],
      submittedAt: null,
      onOpenLink,
    });
    if (!React.isValidElement<{ children: React.ReactNode }>(section)) {
      throw new Error(`expected a delivered section element; actual=${JSON.stringify(section)}`);
    }
    const cardChild = React.Children.only(section.props.children);
    if (!React.isValidElement<{ children: React.ReactNode }>(cardChild)) {
      throw new Error(`expected a delivery card element; actual=${JSON.stringify(cardChild)}`);
    }
    const row = React.Children.toArray(cardChild.props.children)[0];
    if (!React.isValidElement<{ onPress?: () => void }>(row)) {
      throw new Error(`expected a link row; actual=${JSON.stringify(row)}`);
    }

    expect(row.type).toBe(ListItem);
    row.props.onPress?.();
    expect(onOpenLink).toHaveBeenCalledWith('https://files.example.test/final-edit');
  });

  it('shows the provider payment-default action only when the caller says it is eligible', () => {
    const onPress = jest.fn();
    const action = DeliverySection({
      placement: 'payment-default',
      busy: false,
      onPress,
    });
    if (!React.isValidElement<{ title: string; onPress: () => void }>(action)) {
      throw new Error(`expected a payment-default button; actual=${JSON.stringify(action)}`);
    }
    const button = action;

    expect(button.type).toBe(Button);
    expect(button.props.title).toBe('Customer has not paid — close and get paid');
    button.props.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
