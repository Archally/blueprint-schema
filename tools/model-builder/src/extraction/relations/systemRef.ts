import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder } from './resolver.js';
import { normalisePartyRef } from '../entities/partyIdentity.js';
import { SYSTEM_REF_DEFAULT } from '../entities/systemDefaults.js';

/**
 * The system a service is a component of, and the systems a context spans, as edges.
 *
 * One fact, stated three ways by the author and read once here:
 *
 *   - a service NESTED under a party is a component of that party by position (`_party`);
 *   - a service under a ROOT-DECLARED context names its system through `system_ref`;
 *   - or inherits the document's `system_ref` default (`_system_ref_default`), and the edge then
 *     carries `data.inherited`, the way an inherited `owned_by` edge does.
 *
 * `system_ref` (Service -> Party) is emitted for every service the model places in a system. A
 * root-declared context's service that names none and inherits none gets no edge: that is silence,
 * and the semantic checker reports it. A `system_ref` naming a party nothing declares resolves to a
 * placeholder, so the dangling reference is visible in the graph as it is in the validator.
 *
 * A nested service whose `system_ref` names a party other than its envelope states one fact two
 * ways. The validator reports the contradiction; the graph keeps the positional statement and
 * records the other on the edge (`data.declared`, `data.conflict`), so neither is lost and nothing
 * is resolved silently.
 *
 * `spans` (Context -> Party) is derived from those edges: one per distinct system among the
 * context's services, plus the envelope of a nested context, which it spans by position even with
 * no service. A root-declared context that several systems provide services to spans several -
 * the shape the nested form could only state by declaring the context once per system.
 *
 * Built BEFORE the party fold, like every relation: a nested service points at its own document's
 * party row, and `remapRelationEndpoints` moves the edge to the surviving node.
 */
export function extractSystemRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];
  const partiesByBareId = new Map<string, Entity>(); // first declaration wins; the fold remaps the rest
  const partiesByFileAndName = new Map<string, Entity>();
  const contextsByPlacement = new Map<string, Entity>();

  for (const entity of entities) {
    const data = dataOf(entity);
    if (entity.type === ENTITY_TYPE.Party) {
      const declaredId = data.id;
      if (typeof declaredId === 'string' && declaredId.length > 0) {
        const bare = normalisePartyRef(declaredId);
        if (!partiesByBareId.has(bare)) partiesByBareId.set(bare, entity);
      }
      const name = typeof data.name === 'string' ? data.name : entity.displayId ?? '';
      partiesByFileAndName.set(`${entity.fileOrigin ?? ''}|${name}`, entity);
    }
    if (entity.type === ENTITY_TYPE.Context) {
      const key = placementKey(entity, entity.displayId ?? '');
      if (key !== null) contextsByPlacement.set(key, entity);
    }
  }

  // Context id -> the party ids it spans, in first-seen order.
  const spans = new Map<string, Set<string>>();
  const addSpan = (contextId: string, partyId: string): void => {
    let set = spans.get(contextId);
    if (!set) {
      set = new Set<string>();
      spans.set(contextId, set);
    }
    set.add(partyId);
  };

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Context) continue;
    const data = dataOf(entity);
    if (typeof data._party !== 'string') continue;
    const envelope = partiesByFileAndName.get(`${entity.fileOrigin ?? ''}|${data._party}`);
    if (envelope) addSpan(entity.id, envelope.id);
  }

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Service) continue;
    const data = dataOf(entity);
    const declared = typeof data.system_ref === 'string' && data.system_ref.length > 0 ? data.system_ref : null;

    let targetId: string;
    let edgeData: Record<string, unknown> | undefined;

    if (typeof data._party === 'string') {
      const envelope = partiesByFileAndName.get(`${entity.fileOrigin ?? ''}|${data._party}`);
      if (!envelope) continue; // the extractor emits a party before its contexts, so this is unreachable
      targetId = envelope.id;
      const envelopeId = dataOf(envelope).id;
      if (declared && typeof envelopeId === 'string' && normalisePartyRef(declared) !== normalisePartyRef(envelopeId)) {
        edgeData = { declared, conflict: true };
      }
    } else {
      const inherited = declared === null && typeof data[SYSTEM_REF_DEFAULT] === 'string';
      const ref = declared ?? (inherited ? (data[SYSTEM_REF_DEFAULT] as string) : null);
      if (!ref) continue; // silence, reported by the semantic checker rather than drawn
      const party = partiesByBareId.get(normalisePartyRef(ref));
      if (party) {
        targetId = party.id;
      } else {
        const placeholder = createPlaceholder(ref);
        if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
        targetId = placeholder.id;
      }
      if (inherited) edgeData = { inherited: true };
    }

    relations.push({
      id: `${entity.id}--${RELATION_TYPE.SystemRef}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.SystemRef,
      ...(edgeData ? { data: edgeData } : {}),
    });

    const contextKey = placementKey(entity, typeof data._context === 'string' ? data._context : '');
    const context = contextKey === null ? undefined : contextsByPlacement.get(contextKey);
    if (context) addSpan(context.id, targetId);
  }

  for (const [contextId, partyIds] of spans) {
    for (const partyId of partyIds) {
      relations.push({
        id: `${contextId}--${RELATION_TYPE.Spans}--${partyId}`,
        source_entity_id: contextId,
        target_entity_id: partyId,
        type: RELATION_TYPE.Spans,
      });
    }
  }

  return relations;
}

function dataOf(entity: Entity): Record<string, unknown> {
  return (entity.data ?? {}) as Record<string, unknown>;
}

/**
 * Where a context or service sits: its file, its envelope party (empty for the root form) and the
 * context name. Null for an entity that carries neither placement, which no arch extractor emits.
 */
function placementKey(entity: Entity, contextName: string): string | null {
  const data = dataOf(entity);
  const party = typeof data._party === 'string' ? data._party : data._root === true ? '' : null;
  if (party === null) return null;
  return `${entity.fileOrigin ?? ''}|${party}|${contextName}`;
}
