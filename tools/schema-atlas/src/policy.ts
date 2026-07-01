/**
 * Explicit fail / warn / skip policy (DEC-ATL-21).
 *
 * The Atlas must never silently omit material truth or degrade output without
 * signaling it. Every degradation (warn) and every optional omission (skip) is
 * recorded and surfaced; truth-threatening conditions (fail) abort generation.
 */
import type { PolicyEvent, PolicyLevel } from './types.js';

export class PolicyReporter {
  private readonly events: PolicyEvent[] = [];

  private add(level: PolicyLevel, code: string, message: string): void {
    this.events.push({ level, code, message });
  }

  /** Truth-threatening: output would be misleading or untrustworthy. Aborts generation. */
  fail(code: string, message: string): void {
    this.add('fail', code, message);
  }

  /** Output stays trustworthy but is reduced or degraded (e.g. a diagram was split). */
  warn(code: string, message: string): void {
    this.add('warn', code, message);
  }

  /** An optional projection was intentionally omitted. Never silent — always recorded. */
  skip(code: string, message: string): void {
    this.add('skip', code, message);
  }

  hasFailures(): boolean {
    return this.events.some((e) => e.level === 'fail');
  }

  all(): readonly PolicyEvent[] {
    return this.events;
  }

  byLevel(level: PolicyLevel): PolicyEvent[] {
    return this.events.filter((e) => e.level === level);
  }

  /** Human-readable summary for CLI logs. Nothing is hidden. */
  render(): string {
    if (this.events.length === 0) return 'Policy: no warnings, skips, or failures.';
    const lines: string[] = [];
    for (const level of ['fail', 'warn', 'skip'] as PolicyLevel[]) {
      const items = this.byLevel(level);
      if (items.length === 0) continue;
      lines.push(`${level.toUpperCase()} (${items.length}):`);
      for (const e of items) lines.push(`  [${e.code}] ${e.message}`);
    }
    return lines.join('\n');
  }
}
