import { OWNED_BY_DEFAULT } from './ownershipDefaults.js';

/** The three `owned_by` arms that reference an org unit, in schema order. */
export const OWNER_REFERENCE_ARMS = ['team', 'department', 'party'] as const;

/** An `owned_by` arm that references an org unit. */
export type OwnerReferenceArm = (typeof OWNER_REFERENCE_ARMS)[number];

/**
 * What an entity states about its owner: the name, the reference, or both, and whether the statement
 * is the entity's own or its file's default.
 *
 * - `name` is the owner as the source states it. Alone, it names an accountable unit the model does
 *   not declare; beside a reference, it is the name the source used for that unit.
 * - `arm` and `ref` are the first reference arm in schema order (`team`, then `department`, then
 *   `party`) and the id it holds.
 * - `inherited` is true when the statement is the file-level default rather than the entity's own.
 */
export interface OwnerStatement {
  name?: string;
  arm?: OwnerReferenceArm;
  ref?: string;
  inherited: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** The stated owner name of one `owned_by` object, trimmed, or undefined when it holds none. */
export function statedOwnerName(ownedBy: unknown): string | undefined {
  const name = asObject(ownedBy)?.name;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The owner statement an entity carries, read from its own `owned_by` or, when it states none, from
 * the file-level default the model builder wrote under `_owned_by_default`.
 *
 * The inheritance rule is the builder's: an entity's own `owned_by` replaces the default whole, so a
 * name stated on the entity never merges with a reference from the default, or the reverse. An
 * `owned_by` that names nobody (no name, no reference) is no statement, and it still blocks the
 * default, the same way it blocks the inherited edge.
 *
 * Returns undefined when the entity states no owner. A defined result always carries a name, a
 * reference, or both, so "does this entity have an owner?" is `ownerStatementOf(entity) !== undefined`
 * whether the owner is a modelled unit or only a name.
 */
export function ownerStatementOf(entity: { data?: unknown }): OwnerStatement | undefined {
  const data = asObject(entity.data);
  if (!data) return undefined;
  const declared = asObject(data.owned_by);
  const source = declared ?? asObject(data[OWNED_BY_DEFAULT]);
  if (!source) return undefined;

  const statement: OwnerStatement = { inherited: declared === null };
  const name = statedOwnerName(source);
  if (name !== undefined) statement.name = name;
  for (const arm of OWNER_REFERENCE_ARMS) {
    const ref = source[arm];
    if (typeof ref !== 'string' || ref === '') continue;
    statement.arm = arm;
    statement.ref = ref;
    break;
  }
  return statement.name === undefined && statement.arm === undefined ? undefined : statement;
}
