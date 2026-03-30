import type { IdGenerator } from '../../../core/ports/repositories.js';

export class DeterministicIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const nextValue = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, nextValue);
    return `${prefix}-${String(nextValue).padStart(4, '0')}`;
  }
}
