import type { AccumulatorEntry } from '../../domain/accumulator.js';

export interface AccumulatorUsage {
  usedDollars: number;
  usedVisits: number;
  memberOopApplied: number;
  deductibleApplied: number;
}

export function getAccumulatorUsage(
  entries: AccumulatorEntry[],
  periodStart: string,
  periodEnd: string,
  serviceCode?: string
): AccumulatorUsage {
  return entries.reduce<AccumulatorUsage>(
    (usage, entry) => {
      if (entry.benefitPeriodStart !== periodStart || entry.benefitPeriodEnd !== periodEnd) {
        return usage;
      }

      if (entry.status !== 'posted') {
        return usage;
      }

      if (serviceCode && entry.serviceCode !== serviceCode) {
        return usage;
      }

      if (entry.metricType === 'dollars_paid') {
        usage.usedDollars += entry.delta;
      }

      if (entry.metricType === 'visits_used') {
        usage.usedVisits += entry.delta;
      }

      if (entry.metricType === 'member_oop_applied') {
        usage.memberOopApplied += entry.delta;
      }

      if (entry.metricType === 'deductible_applied') {
        usage.deductibleApplied += entry.delta;
      }

      return usage;
    },
    { usedDollars: 0, usedVisits: 0, memberOopApplied: 0, deductibleApplied: 0 }
  );
}

export function createAccumulatorAdjustmentEntries(
  entries: AccumulatorEntry[],
  sourceIdPrefix: string
): AccumulatorEntry[] {
  return entries.map((entry) => ({
    ...entry,
    delta: Number((-entry.delta).toFixed(2)),
    sourceId: `${sourceIdPrefix}:${entry.sourceId}`,
    status: 'posted'
  }));
}
