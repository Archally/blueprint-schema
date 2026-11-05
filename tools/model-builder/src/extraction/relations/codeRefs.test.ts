import { describe, it, expect } from 'vitest';
import { extractCodeRefRelations } from './codeRefs.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

describe('extractCodeRefRelations', () => {
  it('creates CodeFile entities and code_ref relations', () => {
    const entities: Entity[] = [
      {
        id: 'orders-concepts.yaml-CN001',
        displayId: 'CN001',
        type: ENTITY_TYPE.Concept,
        layer: 'design.concepts',
        fileOrigin: 'orders/concepts.yaml',
        data: {
          id: 'CN001',
          name: 'Order',
          code_refs: [
            { path: 'src/domain/Order.ts', role: 'model', line: 10 },
            { path: 'src/domain/Order.test.ts', role: 'test' },
          ],
        },
      },
      {
        id: 'orders-concepts.yaml-CN002',
        displayId: 'CN002',
        type: ENTITY_TYPE.Concept,
        layer: 'design.concepts',
        fileOrigin: 'orders/concepts.yaml',
        data: {
          id: 'CN002',
          name: 'LineItem',
          code_refs: [
            { path: 'src/domain/Order.ts', role: 'model', line: 50 },
          ],
        },
      },
      {
        id: 'orders-domain.yaml-CMD001',
        displayId: 'CMD001',
        type: ENTITY_TYPE.Operation,
        layer: 'design.domain',
        data: { id: 'CMD001', kind: 'command' },
      },
    ];

    const { relations, codeFileEntities } = extractCodeRefRelations(entities);

    // Deduplication: Order.ts appears in both CN001 and CN002, but one CodeFile entity
    expect(codeFileEntities).toHaveLength(2);
    const orderTs = codeFileEntities.find((e) => e.displayId === 'src/domain/Order.ts');
    expect(orderTs).toBeDefined();
    expect(orderTs!.type).toBe(ENTITY_TYPE.CodeFile);
    expect(orderTs!.layer).toBe('code');
    // CodeFile inherits domain from the first referencing entity for clustering
    expect((orderTs!.data as Record<string, unknown>).clusterDomain).toBe('orders');

    const testTs = codeFileEntities.find((e) => e.displayId === 'src/domain/Order.test.ts');
    expect(testTs).toBeDefined();

    // 3 relations: CN001→Order.ts, CN001→Order.test.ts, CN002→Order.ts
    expect(relations).toHaveLength(3);
    expect(relations.every((r) => r.type === RELATION_TYPE.CodeRef)).toBe(true);

    // Check data on relations
    const cn001ToOrderTs = relations.find(
      (r) => r.source_entity_id === 'orders-concepts.yaml-CN001' && (r.data as Record<string, unknown>)?.role === 'model'
    )!;
    expect(cn001ToOrderTs).toBeDefined();
    expect((cn001ToOrderTs.data as Record<string, unknown>).path).toBe('src/domain/Order.ts');
    expect((cn001ToOrderTs.data as Record<string, unknown>).line).toBe(10);
  });

  function conceptWithPaths(paths: string[]): Entity {
    return {
      id: 'orders-concepts.yaml-CN001',
      displayId: 'CN001',
      type: ENTITY_TYPE.Concept,
      layer: 'design.concepts',
      fileOrigin: 'orders/concepts.yaml',
      data: { code_refs: paths.map(path => ({ path, role: 'implementation' })) },
    };
  }

  it('resolves two line fragments on one file to one CodeFile', () => {
    const paths = ['src/Handler.php#L58-L110', 'src/Handler.php#L194'];

    const { relations, codeFileEntities } = extractCodeRefRelations([conceptWithPaths(paths)]);

    expect(codeFileEntities).toHaveLength(1);
    expect(codeFileEntities[0]).toMatchObject({
      id: 'code-file-src-Handler-php',
      displayId: 'src/Handler.php',
      summary: 'src/Handler.php',
      data: { path: 'src/Handler.php' },
    });
    expect(relations).toHaveLength(2);
    expect(relations.map(relation => relation.target_entity_id)).toEqual([
      'code-file-src-Handler-php', 'code-file-src-Handler-php',
    ]);
    expect(relations.map(relation => relation.data)).toEqual(paths.map(path => ({
      path, role: 'implementation',
    })));
  });

  it.each([
    'src/Handler.php',
    'src/Handler#helper.php',
    'org/repository#src/Handler.php',
    'src/Handler.php#L0',
    'src/Handler.php#L9-L2',
    'src/Handler.php#L9007199254740992',
    'src/Handler.php#L2-extra',
  ])('preserves a path without a valid terminal line fragment: %s', path => {
    const { relations, codeFileEntities } = extractCodeRefRelations([conceptWithPaths([path])]);

    expect(codeFileEntities).toHaveLength(1);
    expect(codeFileEntities[0]).toMatchObject({ displayId: path, summary: path, data: { path } });
    expect(relations[0]?.data).toEqual({ path, role: 'implementation' });
  });

  it('preserves the repository prefix when removing a terminal line fragment', () => {
    const paths = ['org/repository#src/Handler.php#L58-L110', 'org/repository#src/Handler.php#L194'];

    const { relations, codeFileEntities } = extractCodeRefRelations([conceptWithPaths(paths)]);

    expect(codeFileEntities).toHaveLength(1);
    expect(codeFileEntities[0]?.displayId).toBe('org/repository#src/Handler.php');
    expect(relations.every(relation => relation.target_entity_id === codeFileEntities[0]?.id)).toBe(true);
  });

  it('skips entities without code_refs', () => {
    const entities: Entity[] = [
      {
        id: 'orders-domain.yaml-CMD001',
        displayId: 'CMD001',
        type: ENTITY_TYPE.Operation,
        layer: 'design.domain',
        data: { id: 'CMD001', kind: 'command' },
      },
    ];

    const { relations, codeFileEntities } = extractCodeRefRelations(entities);
    expect(relations).toHaveLength(0);
    expect(codeFileEntities).toHaveLength(0);
  });

  it('skips code_refs without path', () => {
    const entities: Entity[] = [
      {
        id: 'orders-concepts.yaml-CN001',
        displayId: 'CN001',
        type: ENTITY_TYPE.Concept,
        layer: 'design.concepts',
        data: {
          id: 'CN001',
          name: 'Order',
          code_refs: [{ role: 'model' }], // no path
        },
      },
    ];

    const { relations, codeFileEntities } = extractCodeRefRelations(entities);
    expect(relations).toHaveLength(0);
    expect(codeFileEntities).toHaveLength(0);
  });
});
