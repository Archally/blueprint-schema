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
  // context names collide across parties: one model was measured with the same context name
  // owned by three different parties, so a name-only key resolves to whichever was seen first.
  const contextsByPartyAndName = new Map<string, Entity>();
  for (const ctx of contexts) {
    const party = typeof getData(ctx)._party === 'string' ? (getData(ctx)._party as string) : '';
    const name = ctx.term ?? ctx.displayId;
    contextsByPartyAndName.set(`${party}::${name}`, ctx);
  }

  // PROVIDE-membership: contextId -> op-refs its services provide (expose, send, provide, write).
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
  const addProvided = (entity: Entity, refs: string[]): void => {
    if (!refs.length) return;
    const data = getData(entity);
    const ownerName = typeof data._context === 'string' ? data._context : null;
    if (!ownerName) return;
    const party = typeof data._party === 'string' ? data._party : '';
    const owner = contextsByPartyAndName.get(`${party}::${ownerName}`);
    if (!owner) return;
    const exactSet = ensure(providedExactByContextId, owner.id);
    const foldedSet = ensure(providedFoldedByContextId, owner.id);
    for (const ref of refs) {
      exactSet.add(ref);
      const folded = ref.toLowerCase();
      foldedSet.add(folded);
      allProvidedFolded.add(folded);
    }
  };

  for (const contract of entities) {
    if (contract.type !== ENTITY_TYPE.Contract) continue;
    const data = getData(contract);
    addProvided(contract, [
      ...asStringArray(data.expose),
      ...asStringArray(data.send),
      // The transport-free provider verbs bind exactly as `expose` and `send` do. What they do NOT
      // do is assert a channel, which is the whole reason they exist; the binding is the same fact
      // either way, so it is materialised on the same edge.
      ...asStringArray(data.provide),
      ...asStringArray(data.write),
    ]);
  }

  // A provider that asserts no transport is `contracts.inprocess.provide`, read by the contract pass
  // above like every other provider verb. `expose:` and `send:` name a protocol, and declaring
  // either for an in-process call asserts a channel that does not exist - faking one to satisfy the
  // binder is worse than the unbound report it silences, because every downstream diagram then
  // draws a transport the system does not have.
  //
  // `service.handles` was the older spelling of the same fact and had a pass of its own. Both are
  // gone: the 2.8 schema does not declare the property and nothing binds through it.
  //
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
/**
 * Why nothing bound an operation, for the operations `reason: 'unbound'` names.
 *
 * "Unbound" is one word for several situations a reviewer has to act on differently, and until now
 * the report could not tell them apart. All three are DERIVED from the graph rather than authored:
 * an author states a domain in a file header and services in a context, and whether those two meet
 * is a fact about the model, not a field in it.
 *
 *   - `no-domain-ref` - the operation reaches no domain at all. Its document declares no
 *     `domain_ref` and its slice folder matches no declared domain, so the problem-space half of
 *     the binding was never authored. This is what every unbound operation in every model in this
 *     repository reports today, because no model declares a header yet.
 *   - `no-context-for-domain` - it reaches a domain, and no bounded context realizes that domain.
 *     The two halves exist and do not meet, which is a modelling gap rather than a missing field.
 *   - `multi-context-domain` - it reaches a domain that more than one context realizes, so there is
 *     no single answer to derive. Read today from `context_realizes_domain`, the home reference
 *     alone; a context's `covers[]` will widen the set it is computed over without changing what
 *     the word means.
 *   - `single-context-domain` - it reaches a domain that exactly one context realizes. Nothing is
 *     wrong with the model: this operation's context IS derivable, and the deriving rule is the one
 *     deliberately deferred to the step that brings `covers[]` with it. Counting them is how that
 *     rule's value is known before it is written, and it is the number the fallback-retirement step
 *     needs. Every word here describes the MODEL rather than the tooling, so the vocabulary does not
 *     have to change when the rule lands - these operations simply stop being unbound.
 */
export type UnboundReason =
  | 'no-domain-ref'
  | 'no-context-for-domain'
  | 'single-context-domain'
  | 'multi-context-domain';

export interface MembershipGap {
  entityId: string;
  displayId: string;
  entityType: 'Operation' | 'Question';
  reason: 'unbound' | 'dangling' | 'loose-bind';
  /** The dangling `bounded_context_ref` value, when reason === 'dangling'. */
  ref: string | null;
  /** Why nothing bound it, for an Operation whose reason is `unbound`; null otherwise. */
  unboundReason: UnboundReason | null;
  fileOrigin: string | null;
}

function isLoose(relation: Relation): boolean {
  return (relation.data as { match?: string } | undefined)?.match === 'loose';
}

/**
 * Index the problem-space half of the graph, and answer `UnboundReason` for any operation id.
 *
 * Exported because two callers need the same answer about different populations, and the whole
 * point of the reason is that it cannot disagree with the binder. `findMembershipGaps` asks it
 * about operations that ARE unbound; the ownership report asks it about operations bound only by
 * the fallback, to say what would become of them if the fallback were removed. Re-deriving it in
 * the second place is how the two would come to say different things about one operation.
 *
 * Reads only materialized edges - `operation_in_domain` for the domain an operation reaches, and
 * `context_realizes_domain` for the contexts that realize it.
 */
export function buildUnboundReasonIndex(relations: Relation[]): (entityId: string) => UnboundReason {
  return buildProblemSpaceIndex(relations).reasonOf;
}

/**
 * The problem-space half of the graph, read once and answering both questions that depend on it.
 *
 * `reasonOf` says WHY an operation has no context. `contextOf` says WHICH context the domain hop
 * binds it to, and returns null in precisely the three situations `reasonOf` names as something
 * other than `single-context-domain`. They are one index rather than two because the tier and the
 * projection of the tier must never disagree about an operation - that is the property D31-8 was
 * written for, applied to the rule the projection had been standing in for.
 */
export function buildProblemSpaceIndex(relations: Relation[]): {
  reasonOf: (entityId: string) => UnboundReason;
  contextOf: (entityId: string) => string | null;
} {
  const domainOfOperation = new Map<string, string>();
  const contextsPerDomain = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.type === RELATION_TYPE.OperationInDomain) {
      domainOfOperation.set(relation.source_entity_id, relation.target_entity_id);
    } else if (relation.type === RELATION_TYPE.ContextRealizesDomain) {
      const seen = contextsPerDomain.get(relation.target_entity_id) ?? new Set<string>();
      seen.add(relation.source_entity_id);
      contextsPerDomain.set(relation.target_entity_id, seen);
    }
  }
  const contextsFor = (entityId: string): Set<string> | null => {
    const domainId = domainOfOperation.get(entityId);
    if (!domainId) return null;
    return contextsPerDomain.get(domainId) ?? null;
  };
  return {
    reasonOf: (entityId: string): UnboundReason => {
      if (!domainOfOperation.has(entityId)) return 'no-domain-ref';
      const contexts = contextsFor(entityId);
      if (!contexts || contexts.size === 0) return 'no-context-for-domain';
      return contexts.size === 1 ? 'single-context-domain' : 'multi-context-domain';
    },
    contextOf: (entityId: string): string | null => {
      const contexts = contextsFor(entityId);
      if (!contexts || contexts.size !== 1) return null;
      return [...contexts][0] ?? null;
    },
  };
}

/** `handled_by` tier, read off the edge. Ordered: a lower number outranks a higher one. */
function tierOf(relation: Relation): 1 | 2 | 3 {
  const resolution = (relation.data as { resolution?: unknown } | undefined)?.resolution;
  if (resolution === 'contract') return 1;
  if (resolution === 'domain') return 2;
  return 3;
}

/**
 * TIER 2 - an operation binds to the single bounded context that realizes its domain.
 *
 * Runs over the edges the document pass produced rather than over the documents, because it joins
 * `operation_in_domain` with `context_realizes_domain` and the binder sees neither: both are
 * materialized by later extractors, and `extractMembershipRelations` takes no relations at all.
 *
 * It sits BETWEEN the contract binding and the deprecated name/scope fallback, which is what makes
 * it a tier rather than a second opinion:
 *
 *   - an operation any contract provides is left alone - tier 1 is the author's own statement;
 *   - otherwise, where the domain hop answers, it REPLACES the fallback. The two tiers bind the
 *     same operation to the same context and the relation id is `<op>--handled_by--<ctx>`, so
 *     leaving both would collide on one id and the deduplicator would keep whichever was pushed
 *     first - one pair carrying one resolution, chosen by insertion order. Where the two disagree
 *     about WHICH context, the higher tier wins and the fallback edge goes, because that is what
 *     "tier" means;
 *   - where the domain hop does not answer, nothing changes and the fallback keeps its operations.
 *
 * `match` is `exact`: the domain hop matched no ref at all, and `exact` is the value the fallback
 * already uses for the same reason - there is no widened surface to have matched loosely.
 */
export function applyDomainHopTier(entities: Entity[], relations: Relation[]): Relation[] {
  const operations = entities.filter((e) => e.type === ENTITY_TYPE.Operation);
  if (operations.length === 0) return relations;

  const { contextOf } = buildProblemSpaceIndex(relations);
  const edgesByOperation = new Map<string, Relation[]>();
  for (const relation of relations) {
    if (relation.type !== RELATION_TYPE.HandledBy) continue;
    const bucket = edgesByOperation.get(relation.source_entity_id);
    if (bucket) bucket.push(relation);
    else edgesByOperation.set(relation.source_entity_id, [relation]);
  }

  const promoted = new Set<string>();
  const superseded = new Set<string>();
  const added: Relation[] = [];
  for (const operation of operations) {
    const edges = edgesByOperation.get(operation.id) ?? [];
    if (edges.some((edge) => tierOf(edge) === 1)) continue;
    const contextId = contextOf(operation.id);
    if (!contextId) continue;
    let agreed = false;
    for (const edge of edges) {
      if (edge.target_entity_id === contextId) {
        promoted.add(edge.id);
        agreed = true;
      } else {
        superseded.add(edge.id);
      }
    }
    if (agreed) continue;
    added.push({
      id: relationId(operation.id, RELATION_TYPE.HandledBy, contextId),
      source_entity_id: operation.id,
      target_entity_id: contextId,
      type: RELATION_TYPE.HandledBy,
      data: { resolution: 'domain', match: 'exact' },
    });
  }
  if (promoted.size === 0 && superseded.size === 0 && added.length === 0) return relations;

  const kept = relations
    .filter((relation) => !superseded.has(relation.id))
    .map((relation) =>
      promoted.has(relation.id)
        ? { ...relation, data: { ...(relation.data as object), resolution: 'domain' } }
        : relation,
    );
  return [...kept, ...added];
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

  const unboundReasonOf = buildUnboundReasonIndex(relations);

  const gaps: MembershipGap[] = [];
  const push = (
    entity: Entity,
    reason: MembershipGap['reason'],
    ref: string | null = null,
    unboundReason: UnboundReason | null = null
  ) =>
    gaps.push({
      entityId: entity.id,
      displayId: entity.displayId,
      entityType: entity.type === ENTITY_TYPE.Operation ? 'Operation' : 'Question',
      reason,
      ref,
      unboundReason,
      fileOrigin: entity.fileOrigin ?? null,
    });

  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Operation) {
      if (!boundOps.has(entity.id)) push(entity, 'unbound', null, unboundReasonOf(entity.id));
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
