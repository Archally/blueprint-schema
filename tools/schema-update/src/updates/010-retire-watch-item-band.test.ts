import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update, rebandWatchlist } from './010-retire-watch-item-band.js';

/**
 * The rename, with its negative half first.
 *
 * This module is structural rather than textual, and the reason is the whole test: `W` followed by
 * three digits is a shape prose produces on its own - a part number, a room, a form - and a watch
 * item is referenced by nothing, so there is no dangling reference to justify sweeping the text.
 * The fixture therefore leads with every `W###` that must survive untouched.
 */
const UNTOUCHED_PROSE = `version: "1.0.0"
leverage_points:
  - id: LP001
    title: "Replace the W001 relay in the packing line"
    one_thing: "Ship it"
    consequences_if_done:
      - "The W123 form stops being filled by hand"
watchlist:
  - id: W001
    title: "A signal"
    note: "Triggered when the W900 sensor reports twice"
  - id: orders.W002
    title: "Another"
  - id: WI001
    title: "Not a watch item at all - a work item id, and the character after W is a letter"
  - id: W0011
    title: "Four digits, so not a three-digit id"
  - id: WCH003
    title: "Already migrated"
`;

describe('what must not move', () => {
  const { text, ids } = rebandWatchlist(UNTOUCHED_PROSE);

  it('rewrites exactly the two watch-item ids and nothing else', () => {
    expect(ids).toBe(2);
  });

  it.each(['W001 relay', 'W123 form', 'W900 sensor', 'id: WI001', 'id: W0011', 'id: WCH003'])(
    'leaves %s alone',
    (fragment) => {
      expect(text).toContain(fragment);
    },
  );

  it('a W### inside a note is prose, even inside the watchlist block', () => {
    expect(text).toContain('Triggered when the W900 sensor reports twice');
  });

  it('the control: it does rewrite what it is for, bare and context-qualified', () => {
    // Without this, every assertion above would pass on a function that rewrites nothing.
    expect(text).toContain('- id: WCH001');
    expect(text).toContain('- id: orders.WCH002');
  });

  it('reports the occurrences it left rather than staying silent about them', () => {
    const { untouched } = rebandWatchlist(UNTOUCHED_PROSE);
    expect(untouched).toBeGreaterThan(0);
  });
});

describe('the block scan', () => {
  it('stops at the end of the watchlist block', () => {
    const source = `watchlist:
  - id: W001
    title: "In the block"
leverage_points:
  - id: W002
    title: "Outside it, and not a watch item"
`;
    const { text, ids } = rebandWatchlist(source);
    expect(ids).toBe(1);
    expect(text).toContain('- id: WCH001');
    expect(text).toContain('- id: W002');
  });

  it('a blank line does not end the block', () => {
    const source = `watchlist:
  - id: W001
    title: "One"

  - id: W002
    title: "Two"
`;
    expect(rebandWatchlist(source).ids).toBe(2);
  });

  it('handles a nested watchlist under a scoped map without leaking out of it', () => {
    const source = `scope: orders
watchlist:
  - id: W001
    title: "Scoped"
risks:
  - id: W005
    title: "A risk that is not a watch item"
watchlist:
  - id: W002
    title: "A second block in one file"
`;
    const { text, ids } = rebandWatchlist(source);
    expect(ids).toBe(2);
    expect(text).toContain('- id: W005');
  });

  it('preserves CRLF line endings', () => {
    const source = 'watchlist:\r\n  - id: W001\r\n    title: "One"\r\n';
    const { text } = rebandWatchlist(source);
    expect(text).toContain('\r\n');
    expect(text).toContain('- id: WCH001');
  });

  it('preserves quoting exactly as authored', () => {
    const source = 'watchlist:\n  - id: "W001"\n  - id: \'W002\'\n';
    const { text } = rebandWatchlist(source);
    expect(text).toContain('- id: "WCH001"');
    expect(text).toContain("- id: 'WCH002'");
  });
});

describe('the update as a whole', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-band-'));
    fs.writeFileSync(path.join(dir, 'leverage.yaml'), UNTOUCHED_PROSE, 'utf8');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('plans one edit and names the count', () => {
    const plan = update.plan(dir);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.detail).toContain('2 watch-item id(s)');
  });

  it('plans nothing on a second run - the control, because a chain may re-run it', () => {
    update.apply(dir);
    expect(update.plan(dir).changes).toEqual([]);
  });

  it('warns about the W### it did not touch instead of leaving them unreported', () => {
    expect(update.plan(dir).warnings.join('\n')).toContain('left alone');
  });
});
