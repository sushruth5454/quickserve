import type { ReactElement } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { formatINR } from '../../lib/money';
import { useT } from '../../i18n';
import { useTheme } from '../../theme';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { RatingStars } from '../ui/RatingStars';
import { Text } from '../ui/Text';
import { getLowestQuoteId, sortByPrice, type CompareRow } from './compareModel';
import type { CardPresentation } from './listingModel';

export type { CompareRow } from './compareModel';

export interface QuoteCompareTableProps {
  rows: CompareRow[];
  detailHeaders: [string?, string?];
  selectLabel: string;
  onSelect: (id: string) => void;
  selectedId?: string | null;
  warnings?: Record<string, string[]>;
  selectable?: (id: string) => boolean;
  excludeFromLowest?: (id: string) => boolean;
  presentation?: CardPresentation;
}

export function QuoteCompareTable({
  rows,
  detailHeaders,
  selectLabel,
  onSelect,
  selectedId,
  warnings = {},
  selectable,
  excludeFromLowest,
  presentation = 'legacy',
}: QuoteCompareTableProps): ReactElement {
  const t = useT();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isOorva = presentation === 'oorva';
  const wideOorva = isOorva && width >= 960;
  const sortedRows = sortByPrice(rows);
  const lowestQuoteId = getLowestQuoteId(sortedRows, excludeFromLowest);

  return (
    <View
      style={{
        gap: theme.spacing.md,
        ...(wideOorva ? { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' } : {}),
      }}
    >
      {sortedRows.map((row) => {
        const rowWarnings = warnings[row.id] ?? [];
        const isSelectable = selectable?.(row.id) ?? true;
        const isSelected = selectedId === row.id;

        return (
          <Card
            key={row.id}
            gap={theme.spacing.md}
            style={wideOorva ? { flex: 1, minWidth: 280 } : undefined}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <Text variant="bodyStrong" numberOfLines={isOorva ? undefined : 1}>
                  {row.who}
                </Text>
                {row.rating != null ? <RatingStars value={row.rating} label={row.who} /> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
                <Text variant="calloutStrong" numberOfLines={isOorva ? undefined : 1}>
                  {formatINR(row.pricePaise)}
                </Text>
                {row.id === lowestQuoteId ? <Badge tone="success" label={t('compare.lowest')} /> : null}
              </View>
            </View>

            {row.detail1 != null || row.detail2 != null ? (
              <View
                style={{
                  flexDirection: isOorva ? 'column' : 'row',
                  gap: theme.spacing.md,
                }}
              >
                {row.detail1 != null ? (
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    {detailHeaders[0] ? (
                      <Text variant="footnote" color="muted" numberOfLines={isOorva ? undefined : 1}>
                        {detailHeaders[0]}
                      </Text>
                    ) : null}
                    <Text variant="body" numberOfLines={isOorva ? undefined : 2}>
                      {row.detail1}
                    </Text>
                  </View>
                ) : null}
                {row.detail2 != null ? (
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    {detailHeaders[1] ? (
                      <Text variant="footnote" color="muted" numberOfLines={isOorva ? undefined : 1}>
                        {detailHeaders[1]}
                      </Text>
                    ) : null}
                    <Text variant="body" numberOfLines={isOorva ? undefined : 2}>
                      {row.detail2}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {rowWarnings.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                {rowWarnings.map((warning, index) => (
                  <Badge key={`${row.id}-${index}`} tone="warning" label={warning} />
                ))}
              </View>
            ) : null}

            {isSelectable ? (
              <Button
                title={selectLabel}
                onPress={() => onSelect(row.id)}
                size="sm"
                fullWidth
                variant={isSelected ? 'secondary' : 'primary'}
                accessibilityLabel={`${selectLabel}: ${row.who}`}
              />
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
