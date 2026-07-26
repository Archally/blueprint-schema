// GENERATED — do not edit.
// Emitted by tsc from packages/cli-shared/src/id-allocator/allocator.ts and copied here by scripts/port-parity.mjs.
// The TypeScript module is the single implementation: the vertical CLIs (bp/bv/rl/cstd) and the
// blueprint MCP import it directly, while this plain-ESM emission is what the zero-build public
// tools run. Editing this file makes the two disagree; change the .ts and re-run:
//     npm run build --workspace=packages/cli-shared && npm run port-parity:port

/**
 * Parametrized typed-ID allocator, shared across the vertical CLIs (bp/bv/rl/cstd) and the
 * blueprint MCP. "Next id" is a function of `(prefix, namespace, band, count)` over a set of
 * existing ids — NOT a global counter. Pure and domain-free.
 *
 * Generalizes the legacy bare-prefix `nextId` in
 * `servers/{brandvoice,realm}/cli/src/routing/id-allocator.ts`.
 */
/** Thrown when a reserved band has no free slot left (allocation would spill past `band.max`). */
export class BandExhaustedError extends Error {
    prefix;
    band;
    namespace;
    constructor(prefix, band, namespace) {
        const ns = namespace ? `${namespace}.` : '';
        super(`No free ${ns}${prefix} id left in band [${band.min}..${band.max}].`);
        this.prefix = prefix;
        this.band = band;
        this.namespace = namespace;
        this.name = 'BandExhaustedError';
    }
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Allocate the next free id (or a contiguous block of `count`) for `prefix` in `namespace`,
 * optionally constrained to a reserved `band`. Gap-unaware (`max + 1`), matching the legacy `nextId`.
 *
 * @returns a single id when `count` is 1 (default), else an array of `count` contiguous ids.
 * @throws {BandExhaustedError} when a band is given and the allocation would exceed `band.max`.
 */
export function allocateNextId(options) {
    const { ids, prefix, namespace, band, count = 1, pad } = options;
    if (count < 1)
        throw new Error('count must be >= 1');
    if (band && band.max < band.min)
        throw new Error(`invalid band [${band.min}..${band.max}]`);
    const nsPrefix = namespace ? `${escapeRegExp(namespace)}\\.` : '';
    const pattern = new RegExp(`^${nsPrefix}${escapeRegExp(prefix)}(\\d+)$`);
    // Banded requests start their counter at the band floor; bare requests at 0 (→ first id is 1).
    let maxNum = band ? band.min - 1 : 0;
    let maxWidth = 0;
    for (const id of ids) {
        const match = id.match(pattern);
        if (!match)
            continue;
        const num = Number(match[1]);
        if (band && (num < band.min || num > band.max))
            continue; // ids outside the band belong to other slices
        if (num > maxNum)
            maxNum = num;
        if (match[1].length > maxWidth)
            maxWidth = match[1].length;
    }
    const width = Math.max(pad ?? 3, maxWidth);
    const render = (num) => {
        const core = `${prefix}${String(num).padStart(width, '0')}`;
        return namespace ? `${namespace}.${core}` : core;
    };
    const first = maxNum + 1;
    const last = first + count - 1;
    if (band && last > band.max) {
        throw new BandExhaustedError(prefix, band, namespace);
    }
    if (count === 1)
        return render(first);
    const out = [];
    for (let num = first; num <= last; num += 1)
        out.push(render(num));
    return out;
}
// Pre-filter: `[<namespace>.]<PREFIX><digits>` (2–6 upper-case prefix letters). False positives are
// harmless — {@link allocateNextId} re-filters by the exact requested prefix/namespace.
const ID_LIKE = /^(?:[A-Za-z0-9-]+\.)?[A-Z]{2,6}\d+$/;
/**
 * Recursively harvest id-like strings from a parsed model (any object/array tree) so the allocator
 * can scan them. Collects string leaves matching `[<namespace>.]<PREFIX><digits>`. Pure; no I/O.
 */
export function collectIds(value, out = new Set()) {
    if (typeof value === 'string') {
        if (ID_LIKE.test(value))
            out.add(value);
    }
    else if (Array.isArray(value)) {
        for (const item of value)
            collectIds(item, out);
    }
    else if (value && typeof value === 'object') {
        for (const nested of Object.values(value))
            collectIds(nested, out);
    }
    return out;
}
//# sourceMappingURL=allocator.js.map