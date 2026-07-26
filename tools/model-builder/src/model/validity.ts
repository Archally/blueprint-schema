/**
 * Model validity levels — V0…V5 (review Finding 3, triage item A).
 *
 * ## Why this exists
 *
 * The word "valid" is overloaded, and the overload is dangerous specifically because the primary
 * consumer of this model is an AI agent. A model can:
 *
 *   - parse, but not conform to the schema;
 *   - conform, but carry unresolved references;
 *   - resolve, but violate graph invariants;
 *   - satisfy every invariant, and assert things no evidence supports;
 *   - be internally impeccable, and describe an architecture the code no longer has.
 *
 * Collapsed into one boolean, all five read as "valid" — and an agent can reasonably conclude
 * *"validation passed, therefore this statement about the architecture is true."* It is not:
 * **structural validity is not factual correctness.**
 *
 * ## This is naming, not new machinery
 *
 * Every level below is already computed by a shipped command. What was missing is that each
 * reported a separate verdict from a separate tool, and nothing carried the level into an MCP
 * response. This module gives them one vocabulary so a consumer can ask "how far up was this
 * checked?" and, more importantly, be told what was NOT checked.
 */

/** Ordered from weakest to strongest. Each level presupposes the ones beneath it. */
export const VALIDITY_LEVELS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'] as const;

export type ValidityLevel = (typeof VALIDITY_LEVELS)[number];

/**
 * `not-run` is deliberately distinct from `fail`. "We did not check" and "we checked and it is
 * broken" are different claims, and conflating them is how a gap becomes a false assurance.
 */
export type CheckStatus = 'pass' | 'fail' | 'not-run';

export interface ValidityLevelSpec {
  level: ValidityLevel;
  /** Short name used in output. */
  name: string;
  /** The question this level actually answers. */
  question: string;
  /** What this level does NOT license you to conclude. */
  doesNotImply: string;
  /** The shipped command that establishes it. */
  establishedBy: string;
}

export const VALIDITY_SPECS: Record<ValidityLevel, ValidityLevelSpec> = {
  V0: {
    level: 'V0',
    name: 'parsed',
    question: 'Is the YAML syntactically readable?',
    doesNotImply: 'that any field means what its name suggests',
    establishedBy: 'loader',
  },
  V1: {
    level: 'V1',
    name: 'structural',
    question: 'Do the documents conform to the JSON Schema?',
    doesNotImply: 'that references point at anything',
    establishedBy: 'bp validate',
  },
  V2: {
    level: 'V2',
    name: 'referential',
    question: 'Do typed references resolve, and are identities unique?',
    doesNotImply: 'that the resulting graph is coherent',
    establishedBy: 'bp validate',
  },
  V3: {
    level: 'V3',
    name: 'semantic',
    question: 'Do the configured graph invariants hold?',
    doesNotImply: 'that any claim in the model is supported by evidence',
    establishedBy: 'bp check',
  },
  V4: {
    level: 'V4',
    name: 'epistemic',
    question: 'Are evidence and provenance thresholds met for the claims made?',
    doesNotImply: 'that the implementation matches what is described',
    establishedBy: 'bp quality',
  },
  V5: {
    level: 'V5',
    name: 'implementation-aligned',
    question: 'Do the model’s claims correspond to code that exists?',
    doesNotImply: 'that the architecture described is a good one',
    establishedBy: 'bp coverage-check / bp iac-coverage',
  },
};

/** Per-level status. Every field defaults to `not-run` — silence is never reported as success. */
export interface ModelValidity {
  V0: CheckStatus;
  V1: CheckStatus;
  V2: CheckStatus;
  V3: CheckStatus;
  V4: CheckStatus;
  V5: CheckStatus;
}

export function emptyValidity(): ModelValidity {
  return { V0: 'not-run', V1: 'not-run', V2: 'not-run', V3: 'not-run', V4: 'not-run', V5: 'not-run' };
}

/**
 * The highest level actually established: the deepest V for which it and every level beneath it
 * passed. A `fail` or `not-run` anywhere stops the chain — you cannot claim V3 coherence on a model
 * whose references were never resolved.
 *
 * Returns `null` when not even V0 is established.
 */
export function establishedLevel(validity: ModelValidity): ValidityLevel | null {
  let highest: ValidityLevel | null = null;
  for (const level of VALIDITY_LEVELS) {
    if (validity[level] !== 'pass') break;
    highest = level;
  }
  return highest;
}

/** Levels that were checked and failed. */
export function failedLevels(validity: ModelValidity): ValidityLevel[] {
  return VALIDITY_LEVELS.filter((level) => validity[level] === 'fail');
}

/** Levels nobody checked. These are the ones an agent must not treat as satisfied. */
export function unverifiedLevels(validity: ModelValidity): ValidityLevel[] {
  return VALIDITY_LEVELS.filter((level) => validity[level] === 'not-run');
}

/**
 * A one-line, agent-facing summary that states the ceiling **and** what remains unverified.
 *
 * The second half is the point: a response saying only "V3 semantic: pass" invites exactly the
 * over-claim this module exists to prevent.
 */
export function describeValidity(validity: ModelValidity): string {
  const established = establishedLevel(validity);
  const failed = failedLevels(validity);
  const unverified = unverifiedLevels(validity);

  const parts: string[] = [];
  parts.push(
    established
      ? `established through ${established} (${VALIDITY_SPECS[established].name})`
      : 'nothing established'
  );
  if (failed.length > 0) {
    parts.push(`failed: ${failed.map((level) => `${level} ${VALIDITY_SPECS[level].name}`).join(', ')}`);
  }
  if (unverified.length > 0) {
    parts.push(
      `NOT verified: ${unverified.map((level) => `${level} ${VALIDITY_SPECS[level].name}`).join(', ')}`
    );
  }
  return parts.join(' · ');
}
