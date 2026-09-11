import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Which problem-space domains a bounded context actually serves.
 *
 * `bounded_context.domain_ref` names ONE domain, the context's home, because that is the field a
 * drawing groups by and a context in three domains has no box. The question this file answers is
 * the other one, and it is n-to-n: which areas does this context serve at all?
 *
 * DERIVED FIRST, AND ALONG A PATH THE MODEL ALREADY WALKS. A context's services expose and call
 * operations through their contracts, and each operation belongs to the domain its file header
 * states. Both halves are already materialised - `handled_by` binds an operation to the context
 * whose services provide it, and `operation_in_domain` binds it to its domain - so coverage is
 * their join and needs no second matching rule. That matters more than it sounds: the contract
 * surface matches refs by exact string equality while membership adds a loose fold, and computing
 * coverage from the raw refs again would produce a third answer to one question.
 *
 * DECLARED SECOND, AND ONLY AS AN EXCEPTION. `covers[]` on a context says what no contract can:
 * work done outside any declared contract. It does not replace the derived answer - both are
 * sources over one proposition, and each edge records which one produced it.
 *
 * WHAT THE EDGE CARRIES
 *   - `resolution: 'contract' | 'name' | 'declared'` - which source answered, in the vocabulary
 *     `context_realizes_domain`, `handled_by` and `operation_in_domain` already use, plus one.
 *     `name` is the weaker derived case and is the reason this file reads two fields of
 *     `handled_by` rather than one: an operation bound by the name-and-scope fallback is recorded
 *     `match: 'exact'` there, because its own name match was exact, so coverage reading `match`
 *     alone would present a context nobody wired to a contract as exact contract evidence.
 *   - `operation_count` and `contract_operation_count` - how many operations stand behind the
 *     claim, and how many of those a contract carried. Both absent on a declared edge, because a
 *     declaration counts nothing.
 *   - `match: 'exact' | 'loose'` - how tightly the contract refs matched, and therefore present
 *     ONLY where a contract carried the edge. It describes a contract ref; on a name-derived edge
 *     there is no ref for it to describe.
 *   - `extent` and `reason` from a declared entry, where the author stated them. An ABSENT extent
 *     means unstated and never `full`.
 *
 * A context that both derives and declares the same domain produces ONE edge, the derived one,
 * carrying `also_declared: true`. Two edges for one proposition would be counted twice by anything
 * that aggregates.
 */

interface CoverageAccumulator {
  operationCount: number;
  /** Operations that reached this context through a CONTRACT rather than through a name match. */
  contractCount: number;
  /**
   * True only while every CONTRACT binding behind this pair was loose. A name binding never
   * touches it: `handled_by` records one as `match: 'exact'`, and letting that count would turn a
   * pair whose only contract evidence is a loose fold into an exact one.
   */
  contractLoose: boolean;
}

/** `covers[]` as an author may write it: a bare id, or the full object shape. */
interface CoversEntry {
  ref?: unknown;
  extent?: unknown;
  reason?: unknown;
}

interface Binding {
  /** The operation reached this context through a contract, not through a name match. */
  byContract: boolean;
  loose: boolean;
}

/**
 * `handled_by` carries TWO axes and reading one of them overstates the evidence.
 * `resolution` says whether a contract bound the operation or whether its name and scope did;
 * `match` says how tightly the contract ref matched. A name-bound edge is recorded `exact`,
 * because its own match was exact - so coverage that read `match` alone would report an
 * operation nobody wired to any contract as exact contract evidence.
 */
function readBinding(relation: Relation): Binding {
  const data = relation.data as { match?: unknown; resolution?: unknown } | undefined;
  return { byContract: data?.resolution === 'contract', loose: data?.match === 'loose' };
}

export function extractCoverageRelations(entities: Entity[], relations: Relation[]): Relation[] {
  const contexts = entities.filter((e) => e.type === ENTITY_TYPE.Context);
  if (contexts.length === 0) return [];

  const domainIds = new Set(entities.filter((e) => e.type === ENTITY_TYPE.Domain).map((e) => e.id));
  if (domainIds.size === 0) return [];

  // operation -> the contexts whose services provide it, and on what evidence each bound.
  const contextsByOperation = new Map<string, Map<string, Binding>>();
  // operation -> the domain its file header, or its folder, places it in.
  const domainByOperation = new Map<string, string>();

  for (const relation of relations) {
    if (relation.type === RELATION_TYPE.HandledBy) {
      let bucket = contextsByOperation.get(relation.source_entity_id);
      if (!bucket) {
        bucket = new Map();
        contextsByOperation.set(relation.source_entity_id, bucket);
      }
      // A context reached twice keeps the STRONGEST evidence: any contract binding beats a name
      // match, and any exact contract ref beats a loose one. A name binding contributes nothing to
      // the looseness question, because it matched no ref.
      const seen = bucket.get(relation.target_entity_id);
      const here = readBinding(relation);
      if (seen === undefined) {
        bucket.set(relation.target_entity_id, here);
      } else {
        bucket.set(relation.target_entity_id, {
          byContract: seen.byContract || here.byContract,
          loose: seen.byContract
            ? here.byContract
              ? seen.loose && here.loose
              : seen.loose
            : here.loose,
        });
      }
    } else if (relation.type === RELATION_TYPE.OperationInDomain) {
      if (domainIds.has(relation.target_entity_id)) {
        domainByOperation.set(relation.source_entity_id, relation.target_entity_id);
      }
    }
  }

  // The join, accumulated per context-and-domain pair.
  const derived = new Map<string, CoverageAccumulator>();
  for (const [operationId, contextBucket] of contextsByOperation) {
    const domainId = domainByOperation.get(operationId);
    if (!domainId) continue;
    for (const [contextId, binding] of contextBucket) {
      const key = `${contextId} ${domainId}`;
      const accumulated = derived.get(key);
      if (accumulated) {
        accumulated.operationCount += 1;
        if (binding.byContract) {
          // Only a contract binding may answer the looseness question, and the FIRST one sets it.
          accumulated.contractLoose =
            accumulated.contractCount === 0 ? binding.loose : accumulated.contractLoose && binding.loose;
          accumulated.contractCount += 1;
        }
      } else {
        derived.set(key, {
          operationCount: 1,
          contractCount: binding.byContract ? 1 : 0,
          contractLoose: binding.byContract ? binding.loose : false,
        });
      }
    }
  }

  // Declared entries, read before emitting so a derived edge can say it was also declared.
  const declared = new Map<string, { extent?: string; reason?: string }>();
  for (const context of contexts) {
    const entries = (context.data as { covers?: unknown } | undefined)?.covers;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as Array<CoversEntry | string>) {
      const ref = typeof entry === 'string' ? entry : entry?.ref;
      if (typeof ref !== 'string') continue;
      const target = resolveDomain(ref, entities);
      if (!target) continue;
      const extent =
        typeof entry === 'object' && typeof entry?.extent === 'string' ? entry.extent : undefined;
      const reason =
        typeof entry === 'object' && typeof entry?.reason === 'string' ? entry.reason : undefined;
      declared.set(`${context.id} ${target}`, { extent, reason });
    }
  }

  const out: Relation[] = [];

  for (const [key, accumulated] of derived) {
    const [contextId, domainId] = key.split(' ');
    if (!contextId || !domainId) continue;
    const byContract = accumulated.contractCount > 0;
    const data: Record<string, unknown> = {
      // `contract` only where a contract actually carried it. `name` says the coverage rests on
      // the operation-to-context name-and-scope fallback, which is a weaker claim wearing the
      // same shape, and a reader who cannot tell them apart will read one as the other.
      resolution: byContract ? 'contract' : 'name',
      operation_count: accumulated.operationCount,
      contract_operation_count: accumulated.contractCount,
    };
    // `match` describes how a CONTRACT ref matched, so it is meaningless where none did.
    if (byContract) data.match = accumulated.contractLoose ? 'loose' : 'exact';
    if (declared.has(key)) data.also_declared = true;
    out.push({
      id: `${contextId}--${RELATION_TYPE.ContextCoversDomain}--${domainId}`,
      source_entity_id: contextId,
      target_entity_id: domainId,
      type: RELATION_TYPE.ContextCoversDomain,
      data,
    });
  }

  for (const [key, entry] of declared) {
    if (derived.has(key)) continue;
    const [contextId, domainId] = key.split(' ');
    if (!contextId || !domainId) continue;
    const data: Record<string, unknown> = { resolution: 'declared' };
    if (entry.extent !== undefined) data.extent = entry.extent;
    if (entry.reason !== undefined) data.reason = entry.reason;
    out.push({
      id: `${contextId}--${RELATION_TYPE.ContextCoversDomain}--${domainId}`,
      source_entity_id: contextId,
      target_entity_id: domainId,
      type: RELATION_TYPE.ContextCoversDomain,
      data,
    });
  }

  return out;
}

/**
 * A `covers[].ref` names a domain by its typed id, and an entity id is not that string, so the
 * lookup goes through the authored id the registry carries. A ref naming nothing produces no edge
 * and no placeholder: the schema already makes a dangling reference a cross-reference error, and a
 * second, softer report of the same fact reads as a different finding.
 */
function resolveDomain(ref: string, entities: Entity[]): string | null {
  const bare = ref.includes('.') ? ref.slice(ref.lastIndexOf('.') + 1) : ref;
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Domain) continue;
    const authored = (entity.data as { id?: unknown } | undefined)?.id;
    if (authored === ref || authored === bare) return entity.id;
  }
  return null;
}
