export interface CompareRow {
  id: string;
  who: string;
  pricePaise: number;
  detail1?: string;
  detail2?: string;
  rating?: number | null;
}

export function sortByPrice<T extends { pricePaise: number }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => left.row.pricePaise - right.row.pricePaise || left.index - right.index)
    .map(({ row }) => row);
}

export function getLowestQuoteId(
  rows: readonly CompareRow[],
  excludeFromLowest?: (id: string) => boolean,
): string | null {
  let lowest: CompareRow | undefined;

  for (const row of rows) {
    if (excludeFromLowest?.(row.id)) continue;
    if (!lowest || row.pricePaise < lowest.pricePaise) lowest = row;
  }

  return lowest?.id ?? null;
}
