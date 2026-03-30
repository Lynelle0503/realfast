import type Database from 'better-sqlite3';

import type { Claim } from '../../../core/domain/claim.js';
import type { ClaimRepository } from '../../../core/ports/repositories.js';
import { mapClaimRow } from '../mappers/claim-row-mapper.js';
import { stringifyJson } from '../support/json.js';

interface ClaimRow {
  id: string;
  member_id: string;
  policy_id: string;
  provider_id: string;
  provider_name: string;
  date_of_service: string | null;
  diagnosis_codes_json: string;
  status: 'submitted' | 'under_review' | 'approved' | 'paid';
  approved_line_item_count: number;
}

interface ClaimLineItemRow {
  id: string;
  claim_id: string;
  service_code: string;
  description: string;
  billed_amount: number;
  status: 'submitted' | 'approved' | 'denied' | 'manual_review' | 'paid';
}

interface LineDecisionRow {
  claim_line_item_id: string;
  decision: 'approved' | 'denied' | 'manual_review';
  reason_code: 'SERVICE_NOT_COVERED' | 'YEARLY_CAP_EXCEEDED' | 'VISIT_CAP_EXCEEDED' | 'MISSING_INFORMATION' | 'POLICY_NOT_ACTIVE' | 'MANUAL_REVIEW_REQUIRED' | null;
  reason_text: string | null;
  member_next_step: string | null;
  payer_amount: number | null;
  member_responsibility: number | null;
}

export class SqliteClaimRepository implements ClaimRepository {
  constructor(private readonly db: Database.Database) {}

  async create(claim: Claim): Promise<void> {
    const transaction = this.db.transaction((value: Claim) => {
      this.insertClaimRow(value);
      this.insertLineItems(value);
      this.insertLineDecisions(value);
    });

    transaction(claim);
  }

  async update(claim: Claim): Promise<void> {
    const transaction = this.db.transaction((value: Claim) => {
      this.db
        .prepare(
          `UPDATE claims
           SET provider_id = @provider_id,
               provider_name = @provider_name,
               date_of_service = @date_of_service,
               diagnosis_codes_json = @diagnosis_codes_json,
               status = @status,
               approved_line_item_count = @approved_line_item_count,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = @id`
        )
        .run({
          id: value.claimId,
          provider_id: value.provider.providerId,
          provider_name: value.provider.name,
          date_of_service: value.dateOfService,
          diagnosis_codes_json: stringifyJson(value.diagnosisCodes),
          status: value.status,
          approved_line_item_count: value.approvedLineItemCount
        });

      const updateLineItem = this.db.prepare(
        `UPDATE claim_line_items
         SET service_code = @service_code,
             description = @description,
             billed_amount = @billed_amount,
             status = @status
         WHERE id = @id AND claim_id = @claim_id`
      );

      value.lineItems.forEach((lineItem) => {
        updateLineItem.run({
          id: lineItem.lineItemId,
          claim_id: value.claimId,
          service_code: lineItem.serviceCode,
          description: lineItem.description,
          billed_amount: lineItem.billedAmount,
          status: lineItem.status
        });
      });

      this.db
        .prepare(
          `DELETE FROM line_decisions
           WHERE claim_line_item_id IN (
             SELECT id FROM claim_line_items WHERE claim_id = ?
           )`
        )
        .run(value.claimId);

      this.insertLineDecisions(value);
    });

    transaction(claim);
  }

  async getById(claimId: string): Promise<Claim | null> {
    const row = this.db
      .prepare(
        `SELECT
           id,
           member_id,
           policy_id,
           provider_id,
           provider_name,
           date_of_service,
           diagnosis_codes_json,
           status,
           approved_line_item_count
         FROM claims
         WHERE id = ?`
      )
      .get(claimId) as ClaimRow | undefined;

    if (!row) {
      return null;
    }

    return mapClaimRow(row, this.getClaimLineItemRows(claimId), this.getLineDecisionRows(claimId));
  }

  async listByMemberId(memberId: string): Promise<Claim[]> {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           member_id,
           policy_id,
           provider_id,
           provider_name,
           date_of_service,
           diagnosis_codes_json,
           status,
           approved_line_item_count
         FROM claims
         WHERE member_id = ?
         ORDER BY id`
      )
      .all(memberId) as ClaimRow[];

    return rows.map((row) => mapClaimRow(row, this.getClaimLineItemRows(row.id), this.getLineDecisionRows(row.id)));
  }

  private insertClaimRow(claim: Claim): void {
    this.db
      .prepare(
        `INSERT INTO claims (
           id,
           member_id,
           policy_id,
           provider_id,
           provider_name,
           date_of_service,
           diagnosis_codes_json,
           status,
           approved_line_item_count
         ) VALUES (
           @id,
           @member_id,
           @policy_id,
           @provider_id,
           @provider_name,
           @date_of_service,
           @diagnosis_codes_json,
           @status,
           @approved_line_item_count
         )`
      )
      .run({
        id: claim.claimId,
        member_id: claim.memberId,
        policy_id: claim.policyId,
        provider_id: claim.provider.providerId,
        provider_name: claim.provider.name,
        date_of_service: claim.dateOfService,
        diagnosis_codes_json: stringifyJson(claim.diagnosisCodes),
        status: claim.status,
        approved_line_item_count: claim.approvedLineItemCount
      });
  }

  private insertLineItems(claim: Claim): void {
    const insertLineItem = this.db.prepare(
      `INSERT INTO claim_line_items (
         id,
         claim_id,
         service_code,
         description,
         billed_amount,
         status
       ) VALUES (
         @id,
         @claim_id,
         @service_code,
         @description,
         @billed_amount,
         @status
       )`
    );

    claim.lineItems.forEach((lineItem) => {
      insertLineItem.run({
        id: lineItem.lineItemId,
        claim_id: claim.claimId,
        service_code: lineItem.serviceCode,
        description: lineItem.description,
        billed_amount: lineItem.billedAmount,
        status: lineItem.status
      });
    });
  }

  private insertLineDecisions(claim: Claim): void {
    if (claim.lineDecisions.length === 0) {
      return;
    }

    const insertLineDecision = this.db.prepare(
      `INSERT INTO line_decisions (
         id,
         claim_line_item_id,
         decision,
         reason_code,
         reason_text,
         member_next_step,
         payer_amount,
         member_responsibility
       ) VALUES (
         @id,
         @claim_line_item_id,
         @decision,
         @reason_code,
         @reason_text,
         @member_next_step,
         @payer_amount,
         @member_responsibility
       )`
    );

    claim.lineDecisions.forEach((lineDecision, index) => {
      insertLineDecision.run({
        id: `${claim.claimId}-LD-${String(index + 1).padStart(4, '0')}`,
        claim_line_item_id: lineDecision.lineItemId,
        decision: lineDecision.decision,
        reason_code: lineDecision.reasonCode,
        reason_text: lineDecision.reasonText,
        member_next_step: lineDecision.memberNextStep,
        payer_amount: lineDecision.payerAmount,
        member_responsibility: lineDecision.memberResponsibility
      });
    });
  }

  private getClaimLineItemRows(claimId: string): ClaimLineItemRow[] {
    return this.db
      .prepare(
        `SELECT id, claim_id, service_code, description, billed_amount, status
         FROM claim_line_items
         WHERE claim_id = ?
         ORDER BY id`
      )
      .all(claimId) as ClaimLineItemRow[];
  }

  private getLineDecisionRows(claimId: string): LineDecisionRow[] {
    return this.db
      .prepare(
        `SELECT
           line_decisions.claim_line_item_id,
           line_decisions.decision,
           line_decisions.reason_code,
           line_decisions.reason_text,
           line_decisions.member_next_step,
           line_decisions.payer_amount,
           line_decisions.member_responsibility
         FROM line_decisions
         INNER JOIN claim_line_items
           ON claim_line_items.id = line_decisions.claim_line_item_id
         WHERE claim_line_items.claim_id = ?
         ORDER BY line_decisions.id`
      )
      .all(claimId) as LineDecisionRow[];
  }
}
