import React from 'react';
import { ActivitySegmentControl } from '../ActivitySegmentControl';

jest.mock('react-native', () => {
  const ReactModule = require('react');
  const hostComponent = (name: string) => (props: { children?: React.ReactNode }) =>
    ReactModule.createElement(name, props, props.children);
  return {
    Pressable: hostComponent('Pressable'),
    ScrollView: hostComponent('ScrollView'),
    View: hostComponent('View'),
  };
});

jest.mock('../../../theme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#primary',
      onPrimary: '#on-primary',
      surfaceAlt: '#surface-alt',
      textSecondary: '#text-secondary',
      borderStrong: '#border-strong',
      segmentThumb: '#segment-thumb',
    },
    spacing: { xs: 4, md: 8, lg: 16 },
    radii: { md: 12 },
  }),
}));

jest.mock('../../../components/ui', () => ({ Text: () => null }));

type TestElement = React.ReactElement<{
  testID?: string;
  style?: { backgroundColor?: string; minWidth?: number; color?: string };
  children?: React.ReactNode;
}>;

function badgeParts(element: TestElement) {
  const children = element.props.children as TestElement[];
  const badge = children.find((child) => child.props.style?.minWidth === 18);
  if (!badge) throw new Error('badge container missing');
  return {
    backgroundColor: badge.props.style?.backgroundColor,
    textColor: (badge.props.children as TestElement).props.style?.color,
  };
}

describe('ActivitySegmentControl badge contrast roles', () => {
  it('uses onPrimary on primary for the selected badge', () => {
    const tree = ActivitySegmentControl({
      options: [{ value: 'shop', label: 'Shop', badge: '2' }],
      value: 'shop',
      onChange: jest.fn(),
    }) as TestElement;
    const tab = (tree.props.children as TestElement[]).find(
      (child) => child.props.testID === 'activity-segment-shop',
    );

    expect(tab).toBeDefined();
    expect(badgeParts(tab!)).toEqual({
      backgroundColor: '#primary',
      textColor: '#on-primary',
    });
  });

  it('uses textSecondary on surfaceAlt for a neutral badge', () => {
    const tree = ActivitySegmentControl({
      options: [{ value: 'services', label: 'Services', badge: '1' }],
      value: 'shop',
      onChange: jest.fn(),
    }) as TestElement;
    const tab = (tree.props.children as TestElement[]).find(
      (child) => child.props.testID === 'activity-segment-services',
    );

    expect(tab).toBeDefined();
    expect(badgeParts(tab!)).toEqual({
      backgroundColor: '#surface-alt',
      textColor: '#text-secondary',
    });
  });
});
