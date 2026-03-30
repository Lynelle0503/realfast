import type { AccumulatorEntry } from '../../domain/accumulator.js';

export interface AccumulatorUsage {
  usedDollars: number;
  usedVisits: number;
}

export function getAccumulatorUsage(entries: AccumulatorEntry[], periodStart: string, periodEnd: string): AccumulatorUsage {
  return entries.reduce<AccumulatorUsage>(
    (usage, entry) => {
      if (entry.benefitPeriodStart !== periodStart || entry.benefitPeriodEnd !== periodEnd) {
        return usage;
      }

      if (entry.status !== 'posted') {
        return usage;
      }

      if (entry.metricType === 'dollars_paid') {
        usage.usedDollars += entry.delta;
      }

      if (entry.metricType === 'visits_used') {
        usage.usedVisits += entry.delta;
      }

      return usage;
    },
    { usedDollars: 0, usedVisits: 0 }
  );
}
