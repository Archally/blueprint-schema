import { describe, it, expect } from 'vitest';
import { buildBlueprintModel, groupDocumentsBySchemaType } from './buildModel.js';
import type { ParsedBlueprintDocument } from './types.js';
import { ENTITY_TYPE } from './entityTypes.js';

describe('buildBlueprintModel v2.4', () => {
  it('T03-10: extracts repository config from blueprint root', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          name: 'E-Commerce',
          repository: {
            url: 'https://github.com/acme/ecommerce',
            branch: 'develop',
            provider: 'github',
          },
        },
        filePath: 'blueprint.yaml',
      },
      {
        data: {
          version: '1.0.0',
          concepts: [{ id: 'CN001', name: 'Order' }],
        },
        filePath: 'orders/concepts.yaml',
        scope: 'orders',
      },
    ];

    const documentsByType = groupDocumentsBySchemaType(documents);
    const model = buildBlueprintModel(documentsByType);

    expect(model.metadata.repository).toBeDefined();
    expect(model.metadata.repository!.url).toBe('https://github.com/acme/ecommerce');
    expect(model.metadata.repository!.branch).toBe('develop');
    expect(model.metadata.repository!.provider).toBe('github');
  });

  it('repository is undefined when no blueprint doc', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: { version: '1.0.0', concepts: [{ id: 'CN001', name: 'Order' }] },
        filePath: 'orders/concepts.yaml',
        scope: 'orders',
      },
    ];

    const documentsByType = groupDocumentsBySchemaType(documents);
    const model = buildBlueprintModel(documentsByType);
    expect(model.metadata.repository).toBeUndefined();
  });

  it('question entities and relations appear in full model', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          name: 'Orders',
          operations: [
            { id: 'QRY001', kind: 'query', name: 'Get Order Status' },
          ],
          questions: [
            {
              id: 'QN001',
              statement: 'What is the current status?',
              answered_by: ['QRY001'],
            },
          ],
        },
        filePath: 'orders/domain.yaml',
        scope: 'orders',
      },
    ];

    const documentsByType = groupDocumentsBySchemaType(documents);
    const model = buildBlueprintModel(documentsByType);

    const questions = model.entities.filter((e) => e.type === ENTITY_TYPE.Question);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.displayId).toBe('QN001');

    const answeredByRels = model.relations.filter((r) => r.type === 'question_answered_by');
    expect(answeredByRels).toHaveLength(1);
    expect(answeredByRels[0]!.source_entity_id).toContain('QN001');
    expect(answeredByRels[0]!.target_entity_id).toContain('QRY001');
  });

  it('code_ref entities appear in model when entities have code_refs', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          concepts: [
            {
              id: 'CN001',
              name: 'Order',
              code_refs: [{ path: 'src/Order.ts', role: 'model' }],
            },
          ],
        },
        filePath: 'orders/concepts.yaml',
        scope: 'orders',
      },
    ];

    const documentsByType = groupDocumentsBySchemaType(documents);
    const model = buildBlueprintModel(documentsByType);

    const codeFiles = model.entities.filter((e) => e.type === ENTITY_TYPE.CodeFile);
    expect(codeFiles).toHaveLength(1);
    expect(codeFiles[0]!.displayId).toBe('src/Order.ts');

    const codeRefRels = model.relations.filter((r) => r.type === 'code_ref');
    expect(codeRefRels).toHaveLength(1);
  });

  it('blueprint docs are included in groupDocumentsBySchemaType', () => {
    const documents: ParsedBlueprintDocument[] = [
      { data: { version: '1.0.0', name: 'Test' }, filePath: 'blueprint.yaml' },
      { data: { version: '1.0.0', concepts: [] }, filePath: 'orders/concepts.yaml', scope: 'orders' },
    ];

    const documentsByType = groupDocumentsBySchemaType(documents);
    expect(documentsByType.blueprint).toBeDefined();
    expect(documentsByType.blueprint).toHaveLength(1);
    expect(documentsByType.concepts).toBeDefined();
  });
});
