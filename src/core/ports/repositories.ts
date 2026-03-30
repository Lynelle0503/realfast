import type { AccumulatorEntry } from '../domain/accumulator.js';
import type { Claim } from '../domain/claim.js';
import type { Dispute } from '../domain/dispute.js';
import type { Member } from '../domain/member.js';
import type { Policy } from '../domain/policy.js';

export interface MemberRepository {
  create(member: Member): Promise<void>;
  getById(memberId: string): Promise<Member | null>;
}

export interface PolicyRepository {
  create(policy: Policy): Promise<void>;
  getById(policyId: string): Promise<Policy | null>;
  listByMemberId(memberId: string): Promise<Policy[]>;
}

export interface ClaimRepository {
  create(claim: Claim): Promise<void>;
  update(claim: Claim): Promise<void>;
  getById(claimId: string): Promise<Claim | null>;
  listByMemberId(memberId: string): Promise<Claim[]>;
}

export interface DisputeRepository {
  create(dispute: Dispute): Promise<void>;
  getById(disputeId: string): Promise<Dispute | null>;
  listByClaimId(claimId: string): Promise<Dispute[]>;
}

export interface AccumulatorRepository {
  append(entry: AccumulatorEntry): Promise<void>;
  appendMany(entries: AccumulatorEntry[]): Promise<void>;
  listByPolicyAndService(policyId: string, serviceCode: string): Promise<AccumulatorEntry[]>;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface Clock {
  now(): Date;
}
