import { ApplicationError } from './application-error.js';

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}
