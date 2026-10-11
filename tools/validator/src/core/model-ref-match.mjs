// GENERATED - do not edit.
// Emitted by tsc from the TypeScript module modelRefMatch.ts, its single implementation.
// This plain-ESM copy is what the zero-build tools run. Editing this file makes it disagree with
// its source; change the TypeScript module and regenerate this copy.

/**
 * The `model_ref` FORM rules, with no dependencies - the single definition of what each of the four
 * documented reference forms addresses.
 *
 * This module is shared across the TypeScript/zero-build boundary. The model builder imports it
 * directly, and the zero-build validator runs a plain-ESM copy of it, so the validator answers
 * "does this reference resolve?" with the SAME rules the graph builder uses. Two hand-written copies
 * would eventually disagree, and the disagreement would look like a model defect to whoever hit it.
 *
 * Deliberately free of `Entity` and of every other import: its plain-ESM copy runs with no build
 * step and no node_modules, so it can depend on nothing.
 *
 * The four forms, from `metamodel.schema.yaml` `$defs.model_ref`:
 *   (1) typed id, as declared       `MDL013`, `billing.MDL013`
 *   (2) component name              `OrderSchema`
 *   (3) JSON Pointer                `#/components/schemas/OrderSchema`
 *   (4) file-relative JSON Pointer  `./models.yaml#/components/schemas/OrderSchema`
 */
/** The `components.*` sections a blueprint materializes, mapped to the category stored on a model. */
export const SECTION_TO_CATEGORY = {
    schemas: 'schema',
    'x-field': 'x-field',
    'x-parameter': 'x-parameter',
};
/** Whether a reference is written as a typed model id (form 1), optionally context-prefixed. */
export function isTypedModelId(ref) {
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
export function parseModelPointer(ref) {
    const hash = ref.indexOf('#/');
    if (hash < 0)
        return null;
    const file = hash > 0 ? ref.slice(0, hash) : undefined;
    const segments = ref.slice(hash + 2).split('/').filter(Boolean);
    if (segments.length < 3 || segments[0] !== 'components')
        return null;
    return { file, section: segments[1], name: segments[segments.length - 1] };
}
/** Whether a component's declaring file satisfies a form-4 reference's file part. */
export function fileMatches(componentFile, refFile) {
    const origin = (componentFile ?? '').replace(/\\/g, '/');
    const wanted = refFile.replace(/\\/g, '/').replace(/^\.\//, '');
    return origin === wanted || origin.endsWith(`/${wanted}`);
}
/**
 * Whether a reference addresses this component, in any of the four documented forms.
 *
 * Form 1 matches only the same string as the component's `x-model-id`: a prefix and its dot are part
 * of the id, so `billing.MDL013` and `MDL013` are two ids and neither matches the other.
 *
 * Form 4's file part is checked only when the reference carries one: it exists to disambiguate two
 * files declaring the same component name, and a reference without it addresses the name wherever
 * it lives.
 */
export function matchesModelRef(ref, component) {
    // Form 1 - typed id, exactly as declared.
    if (component.modelId && ref === component.modelId)
        return true;
    // Form 2 - bare component name.
    if (ref === component.name)
        return true;
    // Forms 3 and 4 - a pointer, matched on name AND section.
    const pointer = parseModelPointer(ref);
    if (!pointer)
        return false;
    if (pointer.name !== component.name)
        return false;
    if (SECTION_TO_CATEGORY[pointer.section] !== component.category)
        return false;
    return pointer.file ? fileMatches(component.file, pointer.file) : true;
}
/** Whether any component in the set is addressed by the reference. */
export function resolvesAgainst(ref, components) {
    for (const component of components) {
        if (matchesModelRef(ref, component))
            return true;
    }
    return false;
}
//# sourceMappingURL=modelRefMatch.js.map