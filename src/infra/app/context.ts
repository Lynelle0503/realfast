import type { Clock, IdGenerator } from '../../core/ports/repositories.js';
import type {
  AccumulatorRepository,
  ClaimRepository,
  DisputeRepository,
  MemberRepository,
  PolicyRepository
} from '../../core/ports/repositories.js';
import { SqliteAccumulatorRepository } from '../db/repositories/sqlite-accumulator-repository.js';
import { SqliteClaimRepository } from '../db/repositories/sqlite-claim-repository.js';
import { SqliteDisputeRepository } from '../db/repositories/sqlite-dispute-repository.js';
import { SqliteMemberRepository } from '../db/repositories/sqlite-member-repository.js';
import { SqlitePolicyRepository } from '../db/repositories/sqlite-policy-repository.js';
import { initializeDatabase, type SqliteDatabaseOptions } from '../db/sqlite.js';
import { SystemClock } from '../db/support/clock.js';
import { createDatabaseAwareIdGenerator } from '../db/support/ids.js';

export interface AppContext {
  memberRepository: MemberRepository;
  policyRepository: PolicyRepository;
  claimRepository: ClaimRepository;
  disputeRepository: DisputeRepository;
  accumulatorRepository: AccumulatorRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  close(): void;
}

export function createSqliteAppContext(options: SqliteDatabaseOptions = {}): AppContext {
  const db = initializeDatabase(options);

  return {
    memberRepository: new SqliteMemberRepository(db),
    policyRepository: new SqlitePolicyRepository(db),
    claimRepository: new SqliteClaimRepository(db),
    disputeRepository: new SqliteDisputeRepository(db),
    accumulatorRepository: new SqliteAccumulatorRepository(db),
    idGenerator: createDatabaseAwareIdGenerator(db),
    clock: new SystemClock(),
    close: () => db.close()
  };
}
