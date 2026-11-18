import React, { type ReactElement, type ReactNode } from 'react';
import { BookingStepLayout } from '../BookingStepLayout';

jest.mock('../../ui/Screen', () => ({
  Header: 'MockHeader',
  Screen: 'MockScreen',
}));
jest.mock('../../ui/Stepper', () => ({
  StepIndicator: 'MockStepIndicator',
}));

type TestElement = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

describe('BookingStepLayout', () => {
  it('passes the title and back handler to Header and keeps the footer on Screen', () => {
    const onBack = jest.fn();
    const footer = React.createElement('MockFooter');
    const screen = BookingStepLayout({
      title: 'Book a service',
      steps: ['Type', 'Time'],
      current: 0,
      footer,
      children: 'Booking content',
      onBack,
    }) as TestElement;

    expect(screen.type).toBe('MockScreen');
    expect(screen.props.footer).toBe(footer);
    expect(screen.props.header).toMatchObject({
      type: 'MockHeader',
      props: { title: 'Book a service', onBack },
    });
  });

  it('renders the step indicator before the supplied children', () => {
    const content = React.createElement('MockContent');
    const screen = BookingStepLayout({
      title: 'Book a service',
      steps: ['Type', 'Time', 'Address'],
      current: 1,
      footer: React.createElement('MockFooter'),
      children: content,
    }) as TestElement;
    const children = React.Children.toArray(screen.props.children) as TestElement[];

    expect(children.map((child) => child.type)).toEqual(['MockStepIndicator', 'MockContent']);
    expect(children[0]?.props).toMatchObject({
      steps: ['Type', 'Time', 'Address'],
      current: 1,
    });
  });

  it('leaves back navigation optional', () => {
    const screen = BookingStepLayout({
      title: 'Book a service',
      steps: ['Type'],
      current: 0,
      footer: React.createElement('MockFooter'),
      children: 'Booking content',
    }) as TestElement;

    expect(screen.props.header).toMatchObject({
      type: 'MockHeader',
      props: { title: 'Book a service', onBack: undefined },
    });
  });
});
