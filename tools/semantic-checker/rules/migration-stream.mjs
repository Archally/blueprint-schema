/**
 * Three statements a migration makes about how it is carried out, checked where the schema cannot.
 *
 * - `migrationWithoutTeamOwner`: a migration is carried out by one team, named in `owned_by.team`.
 *   One that names no owner, or names a department or party instead, cannot be placed with the team
 *   that does the work. A name alone is a complete owner statement for a unit the model does not
 *   declare yet, and is not reported.
 * - `migrationReachDisagrees`: a migration may state its reach (`reach`) where its changes cannot show
 *   it. A context or domain its changes reach that the statement leaves out is reported. A stated one
 *   the changes never reach is reported only when every change was traced: while some change could
 *   not be traced, the statement may be what that change touches, so it is neither confirmed nor
 *   reported, and the untraced count is shown instead.
 * - `migrationDependencyReasonUnlisted`: an entry of `depends_on_reasons` names a migration that
 *   `depends_on` does not list, or one already named by an earlier entry.
 *
 * The checks read the Migration nodes the model builder makes from migration documents and register
 * entries; the reach is the builder's `_reach`, derived from the changes with each item's provenance.
 * Tracked register entries sit outside the built model and are checked by validation instead.
 */

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @param {unknown} value */
function stated(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** @param {any} _model @param {any} subject */
export const migrationWithoutTeamOwner = (_model, subject) => {
  if (subject?.type !== 'Migration') return { ok: true };
  const owner = asRecord(subject.data?.owned_by);
  if (!owner) {
    return { ok: false, context: { finding: 'names no owner. State the team that carries it out in `owned_by.team`.' } };
  }
  if (stated(owner.team)) return { ok: true };
  const arm = ['department', 'party'].find((name) => stated(owner[name]));
  if (!arm) return { ok: true };
  return {
    ok: false,
    context: { finding: `names a ${arm} (${owner[arm]}) as its owner. A migration is carried out by one team: name it in \`owned_by.team\`.` },
  };
};

/** @param {Array<{ id: string, provenance: string }>} items @param {string} provenance */
function idsWith(items, provenance) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.provenance === provenance).map((item) => item.id);
}

/** @param {any} _model @param {any} subject */
export const migrationReachDisagrees = (_model, subject) => {
  if (subject?.type !== 'Migration') return { ok: true };
  const reach = asRecord(subject.data?._reach);
  if (!reach || reach.declared !== true) return { ok: true };
  const contexts = /** @type {Array<{ id: string, provenance: string }>} */ (reach.contexts);
  const domains = /** @type {Array<{ id: string, provenance: string }>} */ (reach.domains);
  const unstated = [...idsWith(contexts, 'derived'), ...idsWith(domains, 'derived')];
  const unreached = reach.derivation === 'complete' ? [...idsWith(contexts, 'declared'), ...idsWith(domains, 'declared')] : [];
  if (unstated.length === 0 && unreached.length === 0) return { ok: true };
  const parts = [];
  if (unstated.length > 0) parts.push(`its changes reach ${unstated.join(', ')}, which \`reach\` does not state`);
  if (unreached.length > 0) parts.push(`\`reach\` states ${unreached.join(', ')}, which none of its changes reach`);
  const untraced = typeof reach.not_derived === 'number' && reach.not_derived > 0 ? ` ${reach.not_derived} change(s) could not be traced to a context.` : '';
  return { ok: false, context: { finding: `${parts.join('; and ')}.${untraced}` } };
};

/** @param {any} _model @param {any} subject */
export const migrationDependencyReasonUnlisted = (_model, subject) => {
  if (subject?.type !== 'Migration') return { ok: true };
  const reasons = subject.data?.depends_on_reasons;
  if (!Array.isArray(reasons) || reasons.length === 0) return { ok: true };
  const waits = new Set((Array.isArray(subject.data?.depends_on) ? subject.data.depends_on : []).filter(stated));
  const named = new Set();
  const twice = [];
  const unlisted = [];
  for (const entry of reasons) {
    const migration = asRecord(entry)?.migration;
    if (!stated(migration)) continue;
    if (named.has(migration)) {
      twice.push(migration);
      continue;
    }
    named.add(migration);
    if (!waits.has(migration)) unlisted.push(migration);
  }
  if (twice.length === 0 && unlisted.length === 0) return { ok: true };
  const parts = [];
  if (unlisted.length > 0) parts.push(`gives a reason for waiting for ${unlisted.join(', ')}, which \`depends_on\` does not list`);
  if (twice.length > 0) parts.push(`gives a second reason for ${[...new Set(twice)].join(', ')}`);
  return { ok: false, context: { finding: `${parts.join(', and ')}.` } };
};
