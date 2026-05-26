import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract relations from operation examples with test_ref:
 * - Operation.examples[].test_ref → example_validates (operation → test case)
 *
 * When an operation has examples with test_ref, it means those examples
 * are validated by the referenced test case (Pact contract testing link).
 */
export function extractExampleValidatesRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Operation) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    const examples = data.examples as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(examples)) continue;

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      if (!example || typeof example !== 'object') continue;
      const testRef = example.test_ref as string | undefined;
      if (!testRef) continue;

      const targetId = resolveOrPlaceholder(testRef, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.ExampleValidates}--${targetId}--${i}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.ExampleValidates,
        data: {
          example_name: example.name as string | undefined,
          example_index: i,
        },
      });
    }
  }

  return relations;
}
