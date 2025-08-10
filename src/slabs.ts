import type { Slab } from "./tax";

export const CONFIG = {
  cessRate: 0.04, // 4%

  // New Regime example slabs
  new: {
    slabs: [
      { upto: 300000, rate: 0.0 },
      { upto: 600000, rate: 0.05 },
      { upto: 900000, rate: 0.10 },
      { upto: 1200000, rate: 0.15 },
      { upto: 1500000, rate: 0.20 },
      { upto: null, rate: 0.30 },
    ] as Slab[],
    rebateThreshold: 700000, // Section 87A (example)
  },

  // Old Regime example slabs
  old: {
    slabs: [
      { upto: 250000, rate: 0.0 },
      { upto: 500000, rate: 0.05 },
      { upto: 1000000, rate: 0.20 },
      { upto: null, rate: 0.30 },
    ] as Slab[],
    rebateThreshold: 500000, // Section 87A (example)
  },
} as const;

export type RegimeKey = keyof typeof CONFIG & ("new" | "old");
