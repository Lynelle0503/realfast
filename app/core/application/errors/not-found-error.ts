import { ApplicationError } from './application-error.js';

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}
