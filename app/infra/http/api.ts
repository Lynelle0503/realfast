import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import { adjudicateClaimCommand } from '../../core/application/commands/adjudicate-claim.js';
import { createClaim } from '../../core/application/commands/create-claim.js';
import { createMember } from '../../core/application/commands/create-member.js';
import { createPolicy } from '../../core/application/commands/create-policy.js';
import { markClaimPayment } from '../../core/application/commands/mark-claim-payment.js';
import { openDispute } from '../../core/application/commands/open-dispute.js';
import { resolveDisputeCommand } from '../../core/application/commands/resolve-dispute.js';
import { resolveManualReviewCommand } from '../../core/application/commands/resolve-manual-review.js';
import { ApplicationError } from '../../core/application/errors/application-error.js';
import { BusinessRuleError } from '../../core/application/errors/business-rule-error.js';
import { NotFoundError } from '../../core/application/errors/not-found-error.js';
import { ValidationError } from '../../core/application/errors/validation-error.js';
import { getClaim } from '../../core/application/queries/get-claim.js';
import { getDispute } from '../../core/application/queries/get-dispute.js';
import { getMember } from '../../core/application/queries/get-member.js';
import { getPolicy } from '../../core/application/queries/get-policy.js';
import { listClaimDisputes } from '../../core/application/queries/list-claim-disputes.js';
import { listMembers } from '../../core/application/queries/list-members.js';
import { listMemberClaims } from '../../core/application/queries/list-member-claims.js';
import { listMemberPolicies } from '../../core/application/queries/list-member-policies.js';
import type { AccumulatorEntry } from '../../core/domain/accumulator.js';
import type { Claim, CreateClaimInput, CreateClaimLineItemInput, LineDecision } from '../../core/domain/claim.js';
import type { CreateDisputeInput, Dispute, ResolveDisputeInput } from '../../core/domain/dispute.js';
import type { CreateMemberInput, Member } from '../../core/domain/member.js';
import type { CoverageRules, CreatePolicyInput, Policy } from '../../core/domain/policy.js';
import type {
  AccumulatorRepository,
  ClaimRepository,
  Clock,
  DisputeRepository,
  IdGenerator,
  MemberRepository,
  PolicyRepository
} from '../../core/ports/repositories.js';
import { createSqliteAppContext } from '../app/context.js';
import type { SqliteDatabaseOptions } from '../db/sqlite.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface ApiResponse {
  statusCode: number;
  body: JsonValue;
}

export interface ApiDependencies {
  memberRepository: MemberRepository;
  policyRepository: PolicyRepository;
  claimRepository: ClaimRepository;
  disputeRepository: DisputeRepository;
  accumulatorRepository: AccumulatorRepository;
  idGenerator: IdGenerator;
  clock: Clock;
}

export interface DefaultApiContext extends ApiDependencies {
  close(): void;
}

function json(statusCode: number, body: JsonValue): ApiResponse {
  return { statusCode, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string.`);
  }

  return value;
}

function getOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return getString(value, fieldName);
}

function getStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ValidationError(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function getObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${fieldName} must be an object.`);
  }

  return value;
}

function getNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`${fieldName} must be a number.`);
  }

  return value;
}

function getNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  return getNumber(value, fieldName);
}

function getNullableInteger(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${fieldName} must be an integer or null.`);
  }

  return value;
}

function getBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${fieldName} must be a boolean.`);
  }

  return value;
}

function parseCoverageRules(value: unknown): CoverageRules {
  const record = getObject(value, 'coverageRules');
  const serviceRulesValue = record.serviceRules;
  if (!Array.isArray(serviceRulesValue)) {
    throw new ValidationError('coverageRules.serviceRules must be an array.');
  }

  return {
    benefitPeriod: getString(record.benefitPeriod, 'coverageRules.benefitPeriod') as CoverageRules['benefitPeriod'],
    deductible: getNumber(record.deductible, 'coverageRules.deductible'),
    coinsurancePercent: getNumber(record.coinsurancePercent, 'coverageRules.coinsurancePercent'),
    annualOutOfPocketMax: getNumber(record.annualOutOfPocketMax, 'coverageRules.annualOutOfPocketMax'),
    serviceRules: serviceRulesValue.map((item, index) => {
      const serviceRule = getObject(item, `coverageRules.serviceRules[${index}]`);
      return {
        serviceCode: getString(serviceRule.serviceCode, `coverageRules.serviceRules[${index}].serviceCode`),
        covered: getBoolean(serviceRule.covered, `coverageRules.serviceRules[${index}].covered`),
        yearlyDollarCap: getNullableNumber(
          serviceRule.yearlyDollarCap,
          `coverageRules.serviceRules[${index}].yearlyDollarCap`
        ),
        yearlyVisitCap: getNullableInteger(
          serviceRule.yearlyVisitCap,
          `coverageRules.serviceRules[${index}].yearlyVisitCap`
        )
      };
    })
  };
}

function parseCreateMemberRequest(body: unknown): CreateMemberInput {
  const record = getObject(body, 'body');
  return {
    fullName: getString(record.fullName, 'fullName'),
    dateOfBirth: getString(record.dateOfBirth, 'dateOfBirth')
  };
}

function parseCreatePolicyRequest(memberId: string, body: unknown): CreatePolicyInput {
  const record = getObject(body, 'body');
  return {
    memberId,
    policyType: getString(record.policyType, 'policyType'),
    effectiveDate: getString(record.effectiveDate, 'effectiveDate'),
    coverageRules: parseCoverageRules(record.coverageRules)
  };
}

function parseCreateClaimLineItemRequest(value: unknown, index: number): CreateClaimLineItemInput {
  const record = getObject(value, `lineItems[${index}]`);
  const dateOfService = getOptionalString(record.dateOfService, `lineItems[${index}].dateOfService`);
  return {
    serviceCode: getString(record.serviceCode, `lineItems[${index}].serviceCode`),
    description: getString(record.description, `lineItems[${index}].description`),
    billedAmount: getNumber(record.billedAmount, `lineItems[${index}].billedAmount`),
    ...(dateOfService !== undefined ? { dateOfService } : {})
  };
}

function parseCreateClaimRequest(body: unknown): CreateClaimInput {
  const record = getObject(body, 'body');
  const provider = getObject(record.provider, 'provider');
  const lineItems = record.lineItems;

  if (!Array.isArray(lineItems)) {
    throw new ValidationError('lineItems must be an array.');
  }

  return {
    memberId: getString(record.memberId, 'memberId'),
    policyId: getString(record.policyId, 'policyId'),
    provider: {
      providerId: getString(provider.providerId, 'provider.providerId'),
      name: getString(provider.name, 'provider.name')
    },
    dateOfService: getString(record.dateOfService, 'dateOfService'),
    diagnosisCodes: getStringArray(record.diagnosisCodes, 'diagnosisCodes'),
    lineItems: lineItems.map(parseCreateClaimLineItemRequest)
  };
}

function parseReviewDecisionRequest(body: unknown): { decision: 'approved' | 'denied' } {
  const record = getObject(body, 'body');
  const decision = getString(record.decision, 'decision');
  if (decision !== 'approved' && decision !== 'denied') {
    throw new ValidationError('decision must be approved or denied.');
  }

  return { decision };
}

function parsePaymentRequest(body: unknown): { lineItemIds: string[] } {
  const record = getObject(body, 'body');
  return {
    lineItemIds: getStringArray(record.lineItemIds, 'lineItemIds')
  };
}

function parseCreateDisputeRequest(claimId: string, body: unknown): CreateDisputeInput {
  const record = getObject(body, 'body');
  const input: CreateDisputeInput = {
    claimId,
    reason: getString(record.reason, 'reason')
  };

  const note = getOptionalString(record.note, 'note');
  if (note !== undefined) {
    input.note = note;
  }

  if (record.referencedLineItemIds !== undefined) {
    input.referencedLineItemIds = getStringArray(record.referencedLineItemIds, 'referencedLineItemIds');
  }

  return input;
}

function parseResolveDisputeRequest(disputeId: string, body: unknown): ResolveDisputeInput {
  const record = getObject(body, 'body');
  const outcome = getString(record.outcome, 'outcome');
  if (outcome !== 'upheld' && outcome !== 'overturned') {
    throw new ValidationError('outcome must be upheld or overturned.');
  }

  const input: ResolveDisputeInput = {
    disputeId,
    outcome
  };

  const note = getOptionalString(record.note, 'note');
  if (note !== undefined) {
    input.note = note;
  }

  return input;
}

function mapMember(member: Member): JsonValue {
  const dto: JsonObject = {
    memberId: member.memberId,
    fullName: member.fullName,
    dateOfBirth: member.dateOfBirth
  };
  return dto;
}

function mapPolicy(policy: Policy): JsonValue {
  const dto: JsonObject = {
    policyId: policy.policyId,
    memberId: policy.memberId,
    policyType: policy.policyType,
    effectiveDate: policy.effectiveDate,
    coverageRules: {
      benefitPeriod: policy.coverageRules.benefitPeriod,
      deductible: policy.coverageRules.deductible,
      coinsurancePercent: policy.coverageRules.coinsurancePercent,
      annualOutOfPocketMax: policy.coverageRules.annualOutOfPocketMax,
      serviceRules: policy.coverageRules.serviceRules.map((serviceRule) => ({
        serviceCode: serviceRule.serviceCode,
        covered: serviceRule.covered,
        yearlyDollarCap: serviceRule.yearlyDollarCap,
        yearlyVisitCap: serviceRule.yearlyVisitCap
      }))
    }
  };
  return dto;
}

function mapLineDecision(lineDecision: LineDecision): JsonValue {
  return {
    lineItemId: lineDecision.lineItemId,
    decision: lineDecision.decision,
    reasonCode: lineDecision.reasonCode,
    reasonText: lineDecision.reasonText,
    memberNextStep: lineDecision.memberNextStep,
    payerAmount: lineDecision.payerAmount,
    memberResponsibility: lineDecision.memberResponsibility
  };
}

function mapClaim(claim: Claim): JsonValue {
  const dto: JsonObject = {
    claimId: claim.claimId,
    memberId: claim.memberId,
    policyId: claim.policyId,
    provider: {
      providerId: claim.provider.providerId,
      name: claim.provider.name
    },
    dateOfService: claim.dateOfService,
    diagnosisCodes: claim.diagnosisCodes,
    status: claim.status,
    approvedLineItemCount: claim.approvedLineItemCount,
    lineItems: claim.lineItems.map((lineItem) => ({
      lineItemId: lineItem.lineItemId,
      serviceCode: lineItem.serviceCode,
      description: lineItem.description,
      billedAmount: lineItem.billedAmount,
      dateOfService: lineItem.dateOfService,
      status: lineItem.status
    })),
    lineDecisions: claim.lineDecisions.map(mapLineDecision)
  };

  return dto;
}

function mapClaimSummary(claim: Claim): JsonValue {
  return {
    claimId: claim.claimId,
    memberId: claim.memberId,
    policyId: claim.policyId,
    dateOfService: claim.dateOfService,
    status: claim.status,
    approvedLineItemCount: claim.approvedLineItemCount
  };
}

function mapDispute(dispute: Dispute): JsonValue {
  const dto: JsonObject = {
    disputeId: dispute.disputeId,
    claimId: dispute.claimId,
    memberId: dispute.memberId,
    status: dispute.status,
    reason: dispute.reason,
    note: dispute.note,
    referencedLineItemIds: dispute.referencedLineItemIds,
    resolvedAt: dispute.resolvedAt,
    resolutionNote: dispute.resolutionNote
  };
  return dto;
}

function mapAccumulatorEntry(entry: AccumulatorEntry): JsonValue {
  const dto: JsonObject = {
    memberId: entry.memberId,
    policyId: entry.policyId,
    serviceCode: entry.serviceCode,
    benefitPeriodStart: entry.benefitPeriodStart,
    benefitPeriodEnd: entry.benefitPeriodEnd,
    metricType: entry.metricType,
    delta: entry.delta,
    source: entry.source,
    sourceId: entry.sourceId,
    status: entry.status
  };
  return dto;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
}

function sendJson(response: ServerResponse, apiResponse: ApiResponse): void {
  response.statusCode = apiResponse.statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(apiResponse.body));
}

function sendEmpty(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.end();
}

function getPathSegments(request: IncomingMessage): string[] {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  return requestUrl.pathname.split('/').filter(Boolean);
}

function isApiBase(segments: string[]): boolean {
  return segments[0] === 'api' && segments[1] === 'v1';
}

async function routeRequest(dependencies: ApiDependencies, request: IncomingMessage): Promise<ApiResponse | null> {
  const method = request.method ?? 'GET';
  const segments = getPathSegments(request);

  if (!isApiBase(segments)) {
    return null;
  }

  const resourceSegments = segments.slice(2);

  if (method === 'POST' && resourceSegments.length === 1 && resourceSegments[0] === 'members') {
    const member = await createMember({ memberRepository: dependencies.memberRepository, idGenerator: dependencies.idGenerator }, parseCreateMemberRequest(await readJsonBody(request)));
    return json(201, mapMember(member));
  }

  if (method === 'GET' && resourceSegments.length === 1 && resourceSegments[0] === 'members') {
    const members = await listMembers(dependencies.memberRepository);
    return json(200, { items: members.map(mapMember) });
  }

  if (method === 'GET' && resourceSegments.length === 2 && resourceSegments[0] === 'members') {
    const member = await getMember(dependencies.memberRepository, resourceSegments[1]!);
    return json(200, mapMember(member));
  }

  if (resourceSegments[0] === 'members' && resourceSegments[2] === 'policies' && resourceSegments.length === 3) {
    const memberId = resourceSegments[1]!;

    if (method === 'GET') {
      const policies = await listMemberPolicies(dependencies.policyRepository, memberId);
      return json(200, { items: policies.map(mapPolicy) });
    }

    if (method === 'POST') {
      const policy = await createPolicy(
        {
          memberRepository: dependencies.memberRepository,
          policyRepository: dependencies.policyRepository,
          idGenerator: dependencies.idGenerator
        },
        parseCreatePolicyRequest(memberId, await readJsonBody(request))
      );
      return json(201, mapPolicy(policy));
    }
  }

  if (method === 'GET' && resourceSegments.length === 2 && resourceSegments[0] === 'policies') {
    const policy = await getPolicy(dependencies.policyRepository, resourceSegments[1]!);
    return json(200, mapPolicy(policy));
  }

  if (method === 'GET' && resourceSegments.length === 3 && resourceSegments[0] === 'members' && resourceSegments[2] === 'claims') {
    const claims = await listMemberClaims(dependencies.claimRepository, resourceSegments[1]!);
    return json(200, { items: claims.map(mapClaimSummary) });
  }

  if (method === 'POST' && resourceSegments.length === 1 && resourceSegments[0] === 'claims') {
    const claim = await createClaim(
      {
        memberRepository: dependencies.memberRepository,
        policyRepository: dependencies.policyRepository,
        claimRepository: dependencies.claimRepository,
        idGenerator: dependencies.idGenerator
      },
      parseCreateClaimRequest(await readJsonBody(request))
    );
    return json(201, mapClaim(claim));
  }

  if (method === 'GET' && resourceSegments.length === 2 && resourceSegments[0] === 'claims') {
    const claim = await getClaim(dependencies.claimRepository, resourceSegments[1]!);
    return json(200, mapClaim(claim));
  }

  if (method === 'POST' && resourceSegments.length === 3 && resourceSegments[0] === 'claims' && resourceSegments[2] === 'adjudications') {
    const result = await adjudicateClaimCommand(
      {
        claimRepository: dependencies.claimRepository,
        policyRepository: dependencies.policyRepository,
        accumulatorRepository: dependencies.accumulatorRepository
      },
      resourceSegments[1]!
    );

    return json(200, {
      claim: mapClaim(result.claim),
      accumulatorEffects: result.accumulatorEffects.map(mapAccumulatorEntry)
    });
  }

  if (
    method === 'POST' &&
    resourceSegments.length === 5 &&
    resourceSegments[0] === 'claims' &&
    resourceSegments[2] === 'line-items' &&
    resourceSegments[4] === 'review-decisions'
  ) {
    const result = await resolveManualReviewCommand(
      {
        claimRepository: dependencies.claimRepository,
        policyRepository: dependencies.policyRepository,
        accumulatorRepository: dependencies.accumulatorRepository
      },
      {
        claimId: resourceSegments[1]!,
        lineItemId: resourceSegments[3]!,
        ...parseReviewDecisionRequest(await readJsonBody(request))
      }
    );

    return json(200, mapClaim(result.claim));
  }

  if (method === 'POST' && resourceSegments.length === 3 && resourceSegments[0] === 'claims' && resourceSegments[2] === 'payments') {
    const result = await markClaimPayment(
      { claimRepository: dependencies.claimRepository },
      {
        claimId: resourceSegments[1]!,
        ...parsePaymentRequest(await readJsonBody(request))
      }
    );

    return json(200, mapClaim(result.claim));
  }

  if (resourceSegments.length === 3 && resourceSegments[0] === 'claims' && resourceSegments[2] === 'disputes') {
    const claimId = resourceSegments[1]!;

    if (method === 'POST') {
      const dispute = await openDispute(
        {
          claimRepository: dependencies.claimRepository,
          disputeRepository: dependencies.disputeRepository,
          idGenerator: dependencies.idGenerator
        },
        parseCreateDisputeRequest(claimId, await readJsonBody(request))
      );

      return json(201, mapDispute(dispute));
    }

    if (method === 'GET') {
      const disputes = await listClaimDisputes(dependencies.disputeRepository, claimId);
      return json(200, { items: disputes.map(mapDispute) });
    }
  }

  if (method === 'GET' && resourceSegments.length === 2 && resourceSegments[0] === 'disputes') {
    const dispute = await getDispute(dependencies.disputeRepository, resourceSegments[1]!);
    return json(200, mapDispute(dispute));
  }

  if (method === 'POST' && resourceSegments.length === 3 && resourceSegments[0] === 'disputes' && resourceSegments[2] === 'resolution') {
    const result = await resolveDisputeCommand(
      {
        claimRepository: dependencies.claimRepository,
        policyRepository: dependencies.policyRepository,
        disputeRepository: dependencies.disputeRepository,
        accumulatorRepository: dependencies.accumulatorRepository,
        clock: dependencies.clock
      },
      parseResolveDisputeRequest(resourceSegments[1]!, await readJsonBody(request))
    );

    return json(200, {
      dispute: mapDispute(result.dispute),
      claim: mapClaim(result.claim),
      accumulatorEffects: result.accumulatorEffects.map(mapAccumulatorEntry)
    });
  }

  return null;
}

function mapError(error: unknown): ApiResponse {
  if (error instanceof ValidationError) {
    return json(400, { error: { code: 'VALIDATION_ERROR', message: error.message } });
  }

  if (error instanceof NotFoundError) {
    return json(404, { error: { code: 'NOT_FOUND', message: error.message } });
  }

  if (error instanceof BusinessRuleError) {
    return json(409, { error: { code: 'BUSINESS_RULE_ERROR', message: error.message } });
  }

  if (error instanceof ApplicationError) {
    return json(400, { error: { code: 'APPLICATION_ERROR', message: error.message } });
  }

  return json(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
}

export function createApiHandler(dependencies: ApiDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const apiResponse = await routeRequest(dependencies, request);
      if (!apiResponse) {
        sendEmpty(response, 404);
        return;
      }

      sendJson(response, apiResponse);
    } catch (error) {
      sendJson(response, mapError(error));
    }
  };
}

export function createApiServer(dependencies: ApiDependencies): Server {
  const handler = createApiHandler(dependencies);
  return createServer((request, response) => {
    void handler(request, response);
  });
}

export function createDefaultApiContext(options: SqliteDatabaseOptions = {}): DefaultApiContext {
  return createSqliteAppContext(options);
}
