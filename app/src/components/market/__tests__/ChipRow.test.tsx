import React, { type ReactElement, type ReactNode } from 'react';
import { ChipRow } from '../ChipRow';

jest.mock('react-native', () => ({ ScrollView: 'ScrollView' }));
jest.mock('../../ui/Badge', () => ({ Chip: 'Chip' }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({ spacing: { sm: 8, lg: 16 } }),
}));

type RowElement = ReactElement<{
  horizontal: boolean;
  accessibilityRole: string;
  accessibilityLabel: string;
  contentContainerStyle: { gap: number; paddingHorizontal: number };
  children: ReactNode;
}>;

type ChipElement = ReactElement<{
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  check: boolean;
  onPress: () => void;
}>;

describe('ChipRow', () => {
  it('renders a labelled horizontal tablist with spaced chips and one selected option', () => {
    const row = ChipRow({
      options: [
        { value: 'all', label: 'All' },
        { value: 'services', label: 'Services' },
      ],
      value: 'services',
      onChange: jest.fn(),
      accessibilityLabel: 'Search scope',
    }) as RowElement;

    expect(row.type).toBe('ScrollView');
    expect(row.props).toMatchObject({
      horizontal: true,
      accessibilityRole: 'tablist',
      accessibilityLabel: 'Search scope',
      contentContainerStyle: { gap: 8, paddingHorizontal: 16 },
    });

    const chips = React.Children.toArray(row.props.children) as ChipElement[];
    expect(chips.map(({ props }) => ({
      label: props.label,
      accessibilityLabel: props.accessibilityLabel,
      selected: props.selected,
      check: props.check,
      onPress: props.onPress,
    }))).toEqual([
      { label: 'All', accessibilityLabel: 'All', selected: false, check: false, onPress: expect.any(Function) },
      { label: 'Services', accessibilityLabel: 'Services', selected: true, check: false, onPress: expect.any(Function) },
    ]);
  });

  it('reports the selected option when a chip is pressed', () => {
    const onChange = jest.fn();
    const row = ChipRow({
      options: [{ value: 'sports', label: 'Sports' }],
      value: 'sports',
      onChange,
      accessibilityLabel: 'Browse category',
    }) as RowElement;

    const chip = React.Children.only(row.props.children) as ChipElement;
    chip.props.onPress();

    expect(onChange).toHaveBeenCalledWith('sports');
  });
});
