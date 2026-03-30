export interface BenefitPeriodWindow {
  start: string;
  end: string;
}

export function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseDate(dateString: string): Date {
  return toUtcDate(new Date(`${dateString}T00:00:00.000Z`));
}

export function formatDate(date: Date): string {
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
  return getBenefitPeriodWindowForDate(effectiveDate, formatDate(toUtcDate(asOfDate)));
}

export function getBenefitPeriodWindowForDate(effectiveDate: string, serviceDate: string): BenefitPeriodWindow {
  const effective = parseDate(effectiveDate);
  const dateOfService = parseDate(serviceDate);

  let start = effective;
  while (addYears(start, 1) <= dateOfService) {
    start = addYears(start, 1);
  }

  const end = addDays(addYears(start, 1), -1);
  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}
