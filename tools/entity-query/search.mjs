// GENERATED — do not edit.
// Emitted by tsc from servers/blueprint/cli/src/verbs/entity-search.ts and copied here by scripts/port-parity.mjs.
// The TypeScript module is the single implementation: the vertical CLIs (bp/bv/rl/cstd) and the
// blueprint MCP import it directly, while this plain-ESM emission is what the zero-build public
// tools run. Editing this file makes the two disagree; change the .ts and re-run:
//     npm run build --workspace=servers/blueprint/cli && npm run port-parity:port

/**
 * Pure entity search — the SINGLE implementation behind `bp query` and the zero-build public
 * `tools/entity-query`. Import-free so `tsc` emits self-contained ESM for the public side
 * (plan D38); the DERIVED phase of `scripts/port-parity.mjs` copies the emission to
 * `schemas/blueprint/.shared/entity-query/search.mjs`.
 *
 * This is the deterministic form of "search before you mint" — the rule that stops an authoring
 * agent creating a second entity for something the model already describes. The failure it guards
 * against is silent: a duplicate concept is valid YAML, passes every validator, and only shows up
 * later as two half-modelled versions of the same idea.
 *
 * Ranking is deliberately crude and explainable rather than clever: an id match beats a name match
 * beats a body match. A relevance score nobody can predict is worse than a coarse one everybody
 * can, because the caller is usually deciding "does this already exist?" — a question that needs
 * the exact-id hit at the top, not a plausible-looking paragraph.
 */
const RANK = { exact: 0, id: 1, name: 2, tag: 3, body: 4 };
function lower(values) {
    return values.filter((value) => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase());
}
/** Which field a text query hit, in precedence order, or null if it hit nothing. */
export function matchTextField(entity, text) {
    const needle = text.toLowerCase();
    // An exact id or name hit is the strongest possible "yes, this already exists" — without this
    // tier, searching `order` on a scoped model ranks every `orders.*` entity as an id hit and buries
    // the `Order` concept itself behind `OrderState` and `OrderMessage`. Measured on PrestaShop.
    if (lower([entity.displayId, entity.id, entity.term]).some((value) => value === needle))
        return 'exact';
    if (lower([entity.displayId, entity.id]).some((value) => value.includes(needle)))
        return 'id';
    if (lower([entity.term]).some((value) => value.includes(needle)))
        return 'name';
    if ((entity.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)))
        return 'tag';
    if (lower([entity.summary, entity.description]).some((value) => value.includes(needle)))
        return 'body';
    return null;
}
export function searchEntities(entities, query) {
    const types = query.types?.map((type) => type.trim().toLowerCase()).filter(Boolean) ?? [];
    const layers = query.layers?.map((layer) => layer.trim().toLowerCase()).filter(Boolean) ?? [];
    const tags = query.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [];
    const text = query.text?.trim();
    const hits = [];
    for (const entity of entities) {
        if (types.length > 0 && !types.includes(entity.type.toLowerCase()))
            continue;
        if (layers.length > 0) {
            const layer = entity.layer?.toLowerCase();
            if (!layer || !layers.some((wanted) => layer.includes(wanted)))
                continue;
        }
        if (tags.length > 0) {
            const entityTags = (entity.tags ?? []).map((tag) => tag.toLowerCase());
            if (!tags.some((wanted) => entityTags.includes(wanted)))
                continue;
        }
        let matchField = null;
        if (text) {
            matchField = matchTextField(entity, text);
            if (matchField === null)
                continue;
        }
        hits.push({ entity, matchField });
    }
    // Stable within a rank: filter-only queries keep model order, which is file order.
    if (text)
        hits.sort((a, b) => RANK[a.matchField ?? 'body'] - RANK[b.matchField ?? 'body']);
    const total = hits.length;
    const limit = query.limit && query.limit > 0 ? query.limit : total;
    return { hits: hits.slice(0, limit), total, truncated: Math.max(0, total - limit) };
}
//# sourceMappingURL=entity-search.js.map