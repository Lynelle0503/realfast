import { ApplicationError } from './application-error.js';

export class BusinessRuleError extends ApplicationError {
  constructor(message: string) {
    super('BUSINESS_RULE_ERROR', message);
  }
}
