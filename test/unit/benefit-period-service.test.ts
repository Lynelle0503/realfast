import { describe, expect, it } from 'vitest';

import { getBenefitPeriodWindow } from '../../app/core/application/services/benefit-period-service.js';

describe('benefit period service', () => {
  it('uses policy anniversary boundaries', () => {
    expect(getBenefitPeriodWindow('2026-04-15', new Date('2027-05-01T00:00:00.000Z'))).toEqual({
      start: '2027-04-15',
      end: '2028-04-14'
    });
  });
});
