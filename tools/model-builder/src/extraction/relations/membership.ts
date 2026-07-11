import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * v2.7.6 (D15/D17) — materialize op→BC and question→BC membership as first-class
 * graph relations, so the binding is ONE inspectable fact every consumer reads
 * (backend resolver, CLI, MCP, viewers) and resolvability becomes a declarative
 * rule ("entity with no membership edge → unbound"), rather than being recomputed
 * ad-hoc inside the backend resolver where no validator stack could see it.
 *
 *   Operation --handled_by--> BoundedContext   (m:n; contract-provide PRIMARY, name/scope FALLBACK)
 *   Question  --scoped_to-->   BoundedContext   (single-valued; explicit ref PRIMARY, name/scope FALLBACK)
 *
 * This ports the EXACT resolution the backend arch resolver used to recompute
 * (`resolvers.arch.ts` buildContractIndexes + operationRefsOf + ownedBy) so the
 * observable stickies are unchanged — the resolver becomes a pure reader of these edges.
 *
 * D14: there is NO domain `bounded_context_ref` for operations (contracts are the
 * forward mechanism). D17: questions DO carry an explicit `bounded_context_ref`
 * (single-owner, not derivable from any layer). Concepts are intentionally excluded
 * (genuinely m:n — a context-mapping concern).
 *
 * PARITY NOTE: this is a VERBATIM port of the monorepo core
 * `viewer/v2/core/src/extraction/relations/membership.ts` — the two model-builders
 * inject identical `_context`/`_party`/`_scope`/`_context_name`/`data.id` markers, so
 * the edge sets are identical by construction. The public semantic-checker rules
 * (`unbound-operation.yaml`/`unbound-question.yaml`) walk these edges; the monorepo
 * `get_validation` walks `findMembershipGaps`. Keep both files byte-identical
 * (`reference_blueprint_two_validator_stacks`: mirror every rule to both stacks).
 */

function getData(entity: Entity): Record<string, unknown> {
  return (entity.data as Record<string, unknown> | undefined) ?? {};
}

/** Domain-file name injected on domain entities (`domain.yaml` `name:`). */
function contextNameOf(entity: Entity): string | null {
  const name = getData(entity)._context_name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/** Scope marker injected on domain/arch entities (`scope:` = directory). */
function scopeOf(entity: Entity): string | null {
  const scope = getData(entity)._scope;
  return typeof scope === 'string' && scope.length > 0 ? scope : null;
}

/** A context/service/party authored typed id (`data.id`), full scope-prefixed form. */
function typedIdOf(entity: Entity): string | null {
  const id = getData(entity).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The ref forms an operation may appear as inside a contract's expose/send list —
 * the canonical `domainName:operationName` pair plus the typed id (`CMD001`) and its
 * scope-prefixed form (`scope.CMD001`). Mirrors resolver `operationRefsOf`.
 */
/**
 * The ref forms an operation can be matched by, split by matching PRECISION so the
 * binder can report HOW an op bound (D1 — nothing silently fuzzy-matched):
 *   - `precise`: the fine-grained keys — `domainName:opName` (domain-file qualified) +
 *     the typed id (`CMD001`) and its scope-prefixed form (`scope.CMD001`). An
 *     exact-case hit on one of these is an unambiguous `exact` bind.
 *   - `scoped`: the coarse `scope:opName` form (prestashop's convention). It drops the
 *     domain-file disambiguator, so a hit here (or any case-folded hit) is a `loose`
 *     bind — correct convention-bridging, but wider surface → advisory-worthy.
 */
/**
 * Spaced/kebab/snake operation name → camelCase API-operationId form
 * (`"Get Product"` → `getProduct`). VERBATIM port of the contract generator's
 * `toCamelCase` (viewer/generator/v2.6/src/generators/mermaid/shared/resolve-ownership.ts) —
 * so the core `handled_by` binding recognises the SAME `${context}:${camelCase}` contract-ref
 * convention the generator already groups by (v2.7.6 convergence, one ownership rule).
 */
function toCamelCase(name: string): string {
  const words = name.split(/[\s\-_]+/).filter(Boolean);
  if (words.length === 0) return '';
  return (
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  );
}

function operationRefForms(entity: Entity): { precise: string[]; loose: string[] } {
  const precise: string[] = [];
  const loose: string[] = [];
  const domainName = contextNameOf(entity);
  const scope = scopeOf(entity);
  const opName = entity.term ?? entity.displayId;
  if (opName && domainName) precise.push(`${domainName}:${opName}`);
  if (entity.displayId) {
    precise.push(entity.displayId);
    if (scope) precise.push(`${scope}.${entity.displayId}`);
  }
  // Loose surface — matched case-folded only, so a hit here is `match: 'loose'`:
  //   - the coarse `scope:opName` (prestashop's scope-qualified convention), and
  //   - v2.7.6 CONVERGENCE: the generator's `${context}:${camelCase(opName)}` API-operationId
  //     form (ecommerce `catalog:getProduct` ← "Get Product"), under BOTH the scope and the
  //     domain-file name (the generator keys on one `source_ref.context`; we cover both). This
  //     makes the core `handled_by` binder agree with the generator's contract grouping — the
  //     prerequisite for collapsing the two ownership resolvers in the tool merge.
  if (opName && scope && scope !== domainName) loose.push(`${scope}:${opName}`);
  if (opName) {
    const camel = toCamelCase(opName);
    if (camel) {
      if (scope) loose.push(`${scope}:${camel}`);
      if (domainName) loose.push(`${domainName}:${camel}`);
    }
  }
  return { precise, loose };
}

/** Contract send/receive/expose/call entries: plain strings or {domainName, operationName}. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) {
      out.push(item);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const domain = typeof obj.domainName === 'string' ? obj.domainName : null;
      const opName = typeof obj.operationName === 'string' ? obj.operationName : null;
      if (domain && opName) out.push(`${domain}:${opName}`);
    }
  }
  return out;
}

function relationId(sourceId: string, type: string, targetId: string): string {
  return `${sourceId}--${type}--${targetId}`;
}

export function extractMembershipRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  const contexts = entities.filter((e) => e.type === ENTITY_TYPE.Context);
  const operations = entities.filter((e) => e.type === ENTITY_TYPE.Operation);
  const questions = entities.filter((e) => e.type === ENTITY_TYPE.Question);
  // Fast exit — nothing to bind (keeps concept/rule-only fixtures at 0 edges).
  if (contexts.length === 0 || (operations.length === 0 && questions.length === 0)) {
    return relations;
  }

  // Context owner resolution for contracts — composite (party, contextName) key, since
  // context names collide across parties (measured: one context name owned by three parties).
  const contextsByPartyAndName = new Map<string, Entity>();
  for (const ctx of contexts) {
    const party = typeof getData(ctx)._party === 'string' ? (getData(ctx)._party as string) : '';
    const name = ctx.term ?? ctx.displayId;
    contextsByPartyAndName.set(`${party}::${name}`, ctx);
  }

  // Contract PROVIDE-membership: contextId → op-refs its services provide (expose ∪ send).
  // Kept in BOTH exact case (for `exact` binds) and case-folded (for `loose` binds —
  // contract refs are commonly camelCase `catalog:addProduct` while operation names are
  // PascalCase `AddProduct`, an inherent API↔domain convention gap the binder bridges).
  const providedExactByContextId = new Map<string, Set<string>>();
  const providedFoldedByContextId = new Map<string, Set<string>>();
  const allProvidedFolded = new Set<string>();
  const ensure = (map: Map<string, Set<string>>, key: string): Set<string> => {
    let set = map.get(key);
    if (!set) {
      set = new Set<string>();
      map.set(key, set);
    }
    return set;
  };
  for (const contract of entities) {
    if (contract.type !== ENTITY_TYPE.Contract) continue;
    const data = getData(contract);
    const ownerName = typeof data._context === 'string' ? data._context : null;
    if (!ownerName) continue;
    const party = typeof data._party === 'string' ? data._party : '';
    const owner = contextsByPartyAndName.get(`${party}::${ownerName}`);
    if (!owner) continue;
    const exactSet = ensure(providedExactByContextId, owner.id);
    const foldedSet = ensure(providedFoldedByContextId, owner.id);
    for (const ref of [...asStringArray(data.expose), ...asStringArray(data.send)]) {
      exactSet.add(ref);
      const folded = ref.toLowerCase();
      foldedSet.add(folded);
      allProvidedFolded.add(folded);
    }
  }

  // Name/scope fallback (deprecated) — mirrors resolver `ownedBy`.
  const ownedBy = (entity: Entity, ctx: Entity): boolean => {
    const name = contextNameOf(entity);
    if (name && name === (ctx.term ?? ctx.displayId)) return true;
    const entityScope = scopeOf(entity);
    const ctxScope = scopeOf(ctx);
    if (entityScope && ctxScope && entityScope === ctxScope) return true;
    return false;
  };

  // ── Operation --handled_by--> Context (m:n) ──────────────────────────────
  for (const op of operations) {
    const { precise, loose } = operationRefForms(op);
    const allFolded = [...precise, ...loose].map((r) => r.toLowerCase());
    const providedAnywhere = allFolded.some((ref) => allProvidedFolded.has(ref));
    for (const ctx of contexts) {
      const exactHere = providedExactByContextId.get(ctx.id);
      const foldedHere = providedFoldedByContextId.get(ctx.id);
      // `exact`: a precise ref (domainName:opName / typed id) hit in exact case.
      // `loose`: matched only via the coarse `scope:opName` and/or a case-fold.
      const matchExact = exactHere ? precise.some((ref) => exactHere.has(ref)) : false;
      const matchLoose = !matchExact && foldedHere ? allFolded.some((ref) => foldedHere.has(ref)) : false;
      const byContract = matchExact || matchLoose;
      // Contract-provide is primary (m:n); the deprecated name/scope fallback applies
      // ONLY to operations no contract provides anywhere (else the contract graph owns it).
      const byLegacy = !byContract && !providedAnywhere && ownedBy(op, ctx);
      if (!byContract && !byLegacy) continue;
      relations.push({
        id: relationId(op.id, RELATION_TYPE.HandledBy, ctx.id),
        source_entity_id: op.id,
        target_entity_id: ctx.id,
        type: RELATION_TYPE.HandledBy,
        // `match: 'loose'` only for the wider-surface contract binds (scope/case); legacy
        // name/scope is an exact equality, so it is `exact`.
        data: { resolution: byContract ? 'contract' : 'legacy', match: matchLoose ? 'loose' : 'exact' },
      });
    }
  }

  // ── Question --scoped_to--> Context (single-valued, D17) ─────────────────
  for (const question of questions) {
    const rawRef = getData(question).bounded_context_ref;
    const ref = typeof rawRef === 'string' && rawRef.length > 0 ? rawRef : null;
    if (ref) {
      // Explicit ref is PRIMARY and single-valued. `exact`: an exact-case typed-id
      // (BC###, prefixed) hit. `loose`: matched only via the deprecated kebab-context-name
      // shim (case-insensitive). First match wins.
      const refLower = ref.toLowerCase();
      let target = contexts.find((ctx) => typedIdOf(ctx) === ref);
      let match: 'exact' | 'loose' = 'exact';
      if (!target) {
        target = contexts.find((ctx) => (ctx.term ?? ctx.displayId).toLowerCase() === refLower);
        match = 'loose';
      }
      if (target) {
        relations.push({
          id: relationId(question.id, RELATION_TYPE.ScopedTo, target.id),
          source_entity_id: question.id,
          target_entity_id: target.id,
          type: RELATION_TYPE.ScopedTo,
          data: { resolution: 'ref', match },
        });
      }
      // A ref pointing at an unknown BC### resolves to no edge → the question is
      // unbound (dangling); the resolvability rule (step-12) surfaces it as a WARN.
      continue;
    }
    // FALLBACK — deprecated name/scope heuristic (mirrors resolver `ownedBy`).
    for (const ctx of contexts) {
      if (!ownedBy(question, ctx)) continue;
      relations.push({
        id: relationId(question.id, RELATION_TYPE.ScopedTo, ctx.id),
        source_entity_id: question.id,
        target_entity_id: ctx.id,
        type: RELATION_TYPE.ScopedTo,
        data: { resolution: 'legacy', match: 'exact' },
      });
    }
  }

  return relations;
}

/**
 * v2.7.6 (D5/D15/D17) — resolvability check over the materialized membership edges:
 * an entity that SHOULD belong to a bounded context but has no membership edge is a
 * modelling gap (the "silent empty canvas" D1 was written to catch). Reported as
 * WARNINGS (advisory in v2.7.x; promoted to error in v2.8, D5).
 *
 *   - Operation with no `handled_by` edge → `unbound` (no contract exposes/sends it,
 *     and no name/scope match).
 *   - Question with no `scoped_to` edge → `unbound` (no ref, no name/scope match) OR
 *     `dangling` (it HAS a `bounded_context_ref` but it points at an unknown BC###).
 *   - Operation/Question bound ONLY via a `loose` edge (scope-qualified ref and/or
 *     case-fold, no exact match anywhere) → `loose-bind` (Decyzja-1-A advisory): the
 *     binding works but rests on the widened match surface — verify it, and consider
 *     aligning the contract ref to the operation's exact name/qualifier.
 *
 * Guard: if the model declares NO bounded contexts (no arch layer yet), resolvability
 * is not meaningful — returns [] rather than flooding an early-stage domain-only model.
 */
export interface MembershipGap {
  entityId: string;
  displayId: string;
  entityType: 'Operation' | 'Question';
  reason: 'unbound' | 'dangling' | 'loose-bind';
  /** The dangling `bounded_context_ref` value, when reason === 'dangling'. */
  ref: string | null;
  fileOrigin: string | null;
}

function isLoose(relation: Relation): boolean {
  return (relation.data as { match?: string } | undefined)?.match === 'loose';
}

export function findMembershipGaps(entities: Entity[], relations: Relation[]): MembershipGap[] {
  const hasContext = entities.some((e) => e.type === ENTITY_TYPE.Context);
  if (!hasContext) return [];

  // For each bound entity, track whether ANY of its edges is an exact match — an entity
  // with edges but NO exact edge is a `loose-bind` (bound only on the widened surface).
  const boundOps = new Set<string>();
  const exactOps = new Set<string>();
  const boundQuestions = new Set<string>();
  const exactQuestions = new Set<string>();
  for (const relation of relations) {
    if (relation.type === RELATION_TYPE.HandledBy) {
      boundOps.add(relation.source_entity_id);
      if (!isLoose(relation)) exactOps.add(relation.source_entity_id);
    } else if (relation.type === RELATION_TYPE.ScopedTo) {
      boundQuestions.add(relation.source_entity_id);
      if (!isLoose(relation)) exactQuestions.add(relation.source_entity_id);
    }
  }

  const gaps: MembershipGap[] = [];
  const push = (entity: Entity, reason: MembershipGap['reason'], ref: string | null = null) =>
    gaps.push({
      entityId: entity.id,
      displayId: entity.displayId,
      entityType: entity.type === ENTITY_TYPE.Operation ? 'Operation' : 'Question',
      reason,
      ref,
      fileOrigin: entity.fileOrigin ?? null,
    });

  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Operation) {
      if (!boundOps.has(entity.id)) push(entity, 'unbound');
      else if (!exactOps.has(entity.id)) push(entity, 'loose-bind');
    } else if (entity.type === ENTITY_TYPE.Question) {
      if (boundQuestions.has(entity.id)) {
        if (!exactQuestions.has(entity.id)) push(entity, 'loose-bind');
        continue;
      }
      const rawRef = getData(entity).bounded_context_ref;
      const ref = typeof rawRef === 'string' && rawRef.length > 0 ? rawRef : null;
      push(entity, ref ? 'dangling' : 'unbound', ref);
    }
  }
  return gaps;
}
