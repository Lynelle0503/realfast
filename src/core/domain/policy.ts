import type { BenefitPeriod } from './enums.js';

export interface ServiceRule {
  serviceCode: string;
  covered: boolean;
  yearlyDollarCap: number | null;
  yearlyVisitCap: number | null;
}

export interface CoverageRules {
  benefitPeriod: BenefitPeriod;
  deductible: number;
  coinsurancePercent: number;
  annualOutOfPocketMax: number;
  serviceRules: ServiceRule[];
}

export interface Policy {
  policyId: string;
  memberId: string;
  policyType: string;
  effectiveDate: string;
  coverageRules: CoverageRules;
}

export interface CreatePolicyInput {
  memberId: string;
  policyType: string;
  effectiveDate: string;
  coverageRules: CoverageRules;
}
