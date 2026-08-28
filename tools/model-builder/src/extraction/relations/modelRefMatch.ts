/**
 * The `model_ref` FORM rules, with no dependencies - the single definition of what each of the four
 * documented reference forms addresses.
 *
 * This module exists to be shared across the TS/zero-build boundary. The model-builder imports it
 * directly (`modelRef.ts`), and `scripts/port-parity.mjs` emits it as plain ESM into
 * `.shared/validator/core/model-ref-match.mjs`, so the zero-build validator answers "does this
 * reference resolve?" with the SAME rules the graph builder uses. Two hand-written copies would
 * eventually disagree, and the disagreement would look like a model defect to whoever hit it.
 *
 * Deliberately free of `Entity` and of every other import: it is emitted into a package that has no
 * build step and no node_modules, so it can depend on nothing.
 *
 * The four forms, from `metamodel.schema.yaml` `$defs.model_ref`:
 *   (1) typed id                    `MDL013`, `billing.MDL013`
 *   (2) component name              `OrderSchema`
 *   (3) JSON Pointer                `#/components/schemas/OrderSchema`
 *   (4) file-relative JSON Pointer  `./models.yaml#/components/schemas/OrderSchema`
 */

/** The `components.*` sections a blueprint materializes, mapped to the category stored on a model. */
export const SECTION_TO_CATEGORY: Record<string, string> = {
  schemas: 'schema',
  'x-field': 'x-field',
  'x-parameter': 'x-parameter',
};

/** A model component, described in the terms both consumers can supply. */
export interface ModelComponentRef {
  /** The `components.<section>` key, i.e. what a bare name or a pointer's last segment addresses. */
  name: string;
  /** `schema` | `x-field` | `x-parameter`. */
  category: string;
  /** Typed id from `x-model-id`, when the component declares one. */
  modelId?: string;
  /** Path of the file the component was declared in, for a form-4 reference's file part. */
  file?: string;
}

export interface ParsedModelPointer {
  /** The file part of a form-4 reference (`./models.yaml`), absent for form 3. */
  file?: string;
  /** The `components.<section>` segment, e.g. `schemas`. */
  section: string;
  /** The component name, i.e. the final segment. */
  name: string;
}

/** Whether a reference is written as a typed model id (form 1), optionally context-prefixed. */
export function isTypedModelId(ref: string): boolean {
  return /^([a-z][a-z0-9-]*\.)?MDL\d{3,}$/.test(ref);
}

/**
 * Parse a JSON-Pointer `model_ref` (form 3 or 4) into its parts, or `null` if it is neither.
 *
 * A pointer is treated as a PATH rather than as a name with decoration, which is why the section is
 * kept: `#/components/schemas/X` does not address an `X` declared under `x-field`. A pointer into a
 * section blueprints do not materialize parses fine and then matches nothing, which is the honest
 * answer rather than a silent fallback to name matching.
 */
export function parseModelPointer(ref: string): ParsedModelPointer | null {
  const hash = ref.indexOf('#/');
  if (hash < 0) return null;
  const file = hash > 0 ? ref.slice(0, hash) : undefined;
  const segments = ref.slice(hash + 2).split('/').filter(Boolean);
  if (segments.length < 3 || segments[0] !== 'components') return null;
  return { file, section: segments[1]!, name: segments[segments.length - 1]! };
}

/** Whether a component's declaring file satisfies a form-4 reference's file part. */
export function fileMatches(componentFile: string | undefined, refFile: string): boolean {
  const origin = (componentFile ?? '').replace(/\\/g, '/');
  const wanted = refFile.replace(/\\/g, '/').replace(/^\.\//, '');
  return origin === wanted || origin.endsWith(`/${wanted}`);
}

/**
 * Whether a reference addresses this component, in any of the four documented forms.
 *
 * Form 4's file part is checked only when the reference carries one: it exists to disambiguate two
 * files declaring the same component name, and a reference without it addresses the name wherever
 * it lives.
 */
export function matchesModelRef(ref: string, component: ModelComponentRef): boolean {
  // Form 1 - typed id, with or without a context prefix.
  if (component.modelId && (ref === component.modelId || ref.endsWith(`.${component.modelId}`))) {
    return true;
  }
  // Form 2 - bare component name.
  if (ref === component.name) return true;

  // Forms 3 and 4 - a pointer, matched on name AND section.
  const pointer = parseModelPointer(ref);
  if (!pointer) return false;
  if (pointer.name !== component.name) return false;
  if (SECTION_TO_CATEGORY[pointer.section] !== component.category) return false;
  return pointer.file ? fileMatches(component.file, pointer.file) : true;
}

/** Whether any component in the set is addressed by the reference. */
export function resolvesAgainst(ref: string, components: Iterable<ModelComponentRef>): boolean {
  for (const component of components) {
    if (matchesModelRef(ref, component)) return true;
  }
  return false;
}
