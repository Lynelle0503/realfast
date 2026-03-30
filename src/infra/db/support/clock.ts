import type { Clock } from '../../../core/ports/repositories.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
