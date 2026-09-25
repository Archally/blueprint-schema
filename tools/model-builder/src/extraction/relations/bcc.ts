import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Bounded Context Canvas relations for the three canvas-bearing entities - BusinessDecision,
 * Assumption and KPI:
 *
 * - BusinessDecision → UserStory  (linked_user_stories[])
 * - BusinessDecision | Assumption | KPI → Context  (bounded_context_ref, when it is a BC### id)
 *
 * WHAT DOES NOT BUILD AN EDGE, and why it is the whole point of this file.
 *
 * `domain_scope` is typed `scope_prefix`, whose own `$def` says: "In both roles it is a name
 * matched by value rather than a typed reference: it resolves to no entity, and a reference to a
 * bounded context is `bounded_context_ref` (BC###) instead." `linked_contexts[]` is the same type.
 * A kebab-case slug names the problem-space region an element belongs to; it addresses nothing.
 *
 * Resolving one anyway manufactured a Missing placeholder per slice name - one gray node per slice,
 * which the viewer draws as an entity the model does not have. Measured 2026-09-20 across every
 * model in `projects/`: 66 of the 70 edges this file produced pointed at such a placeholder.
 *
 * The other 4 are the argument, not the exception. All four sit in one model, on Assumptions whose
 * `domain_scope` happens to match a Context declared with a kebab-case displayId rather than the
 * PascalCase its other fifty-two use. In that same model another slug produced a placeholder while
 * a Context of that name sits right there, spelled with a capital. One capital letter decided
 * whether a governance statement got an edge or a gray dot - which is what a name match is, and
 * why the schema declines to call it a reference.
 *
 * `affects.context_refs[]` is the same field type and `affects.ts` has always treated it this way.
 *
 * THE ONE FORM THAT DOES RESOLVE. `bounded_context_ref` is read because it is the v2.6/v2.7
 * spelling of this field and this extractor serves every line the loader accepts - but in those
 * versions it is typed `context_prefix` (pattern `^[a-z][a-z0-9-]*$`, "Bounded context name in
 * kebab-case"), so it is a NAME there too and is skipped on the same grounds. Only a value in the
 * v2.8 `bounded_context_ref` form - `BC001`, `shop.BC001` - is a typed reference, and that one
 * resolves. So no model can lose an edge it actually declared: the guard is on the VALUE's form,
 * not on which key carries it.
 */

/** The v2.8 `bounded_context_ref` form: a BC### arch id, optionally context-qualified. */
const TYPED_CONTEXT_ID = /^([a-z][a-z0-9-]*\.)?BC\d{3,}$/;

const CANVAS_TYPES: ReadonlySet<string> = new Set([
  ENTITY_TYPE.BusinessDecision,
  ENTITY_TYPE.Assumption,
  ENTITY_TYPE.KPI,
]);

export function extractBccRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;
    const domain = entityDomain(entity);

    // BusinessDecision | Assumption | KPI → Context, for a typed BC### reference only.
    // `domain_scope` and a kebab-case `bounded_context_ref` are names and build nothing.
    if (CANVAS_TYPES.has(entity.type)) {
      const ref = data.bounded_context_ref;
      if (typeof ref === 'string' && TYPED_CONTEXT_ID.test(ref)) {
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.BoundedContextRef}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.BoundedContextRef,
        });
      }
    }

    // BusinessDecision → UserStory. `user_story_ref` is a typed reference, unlike the two
    // context fields above, so it resolves and a dangling one is a real authoring defect.
    if (entity.type === ENTITY_TYPE.BusinessDecision) {
      const linkedUserStories = data.linked_user_stories as string[] | undefined;
      if (Array.isArray(linkedUserStories)) {
        for (const ref of linkedUserStories) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.BusinessDecisionLinkedUserStory}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.BusinessDecisionLinkedUserStory,
          });
        }
      }
    }
  }

  return relations;
}
