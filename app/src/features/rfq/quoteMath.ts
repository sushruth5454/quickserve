export interface QuoteEstimateLine {
  quantity: number;
  unitPricePaise: number;
  gstRateBp: number;
  available: boolean;
}

export interface QuoteTotals {
  subtotal: number;
  gst: number;
  total: number;
}

export function estimateQuoteTotals(lines: QuoteEstimateLine[], deliveryPaise: number): QuoteTotals {
  let subtotal = 0;
  let gst = 0;
  for (const line of lines) {
    if (!line.available) continue;
    const lineTotal = Math.round(line.quantity * line.unitPricePaise);
    subtotal += lineTotal;
    gst += Math.round(lineTotal * line.gstRateBp / 10000);
  }
  return { subtotal, gst, total: subtotal + gst + deliveryPaise };
}
