export interface BenefitPeriodWindow {
  start: string;
  end: string;
}

function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDate(dateString: string): Date {
  return toUtcDate(new Date(`${dateString}T00:00:00.000Z`));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addYears(date: Date, years: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCFullYear(copy.getUTCFullYear() + years);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function getBenefitPeriodWindow(effectiveDate: string, asOfDate: Date): BenefitPeriodWindow {
  const effective = parseDate(effectiveDate);
  const today = toUtcDate(asOfDate);

  let start = effective;
  while (addYears(start, 1) <= today) {
    start = addYears(start, 1);
  }

  const end = addDays(addYears(start, 1), -1);
  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}
