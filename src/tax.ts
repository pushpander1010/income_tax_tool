export type Slab = { upto: number | null; rate: number }; // rate as 0..1

export function computeTaxCore(income: number, slabs: Slab[]): number {
  if (!isFinite(income) || income <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const s of slabs) {
    const cap = s.upto ?? Infinity;
    if (income <= prev) break;
    const taxable = Math.max(0, Math.min(income, cap) - prev);
    tax += taxable * s.rate;
    prev = cap;
  }
  return Math.max(0, Math.round(tax)); // round to nearest rupee
}

export function applyRebate87A(
  income: number,
  basicTax: number,
  rebateThreshold: number
): number {
  // Simple version: full rebate if income <= threshold.
  // (Marginal relief rules can be added later if needed.)
  if (income <= rebateThreshold) return 0;
  return basicTax;
}

export function withCess(basicTax: number, cessRate: number) {
  const cess = Math.round(basicTax * cessRate);
  return { cess, total: basicTax + cess };
}
