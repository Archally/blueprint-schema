import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAtlasModel } from './introspect.js';
import { resolveSchemaDir } from './schema-io.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaRoot = process.env.BLUEPRINT_ATLAS_TEST_SCHEMA_ROOT ?? path.resolve(here, '../../../schema');
const v27 = resolveSchemaDir(path.join(schemaRoot, 'v2.7'));

describe('buildAtlasModel (v2.7)', () => {
  const model = buildAtlasModel('v2.7', v27);

  it('represents the full version end to end', () => {
    expect(model.files.length).toBeGreaterThan(15);
    const rels = model.files.map((f) => f.relPath);
    expect(rels).toContain('design/domain.schema.yaml');
    expect(rels).toContain('governance/motivation.schema.yaml');
    expect(rels).toContain('metamodel.schema.yaml');
  });

  it('preserves plane boundaries', () => {
    const design = model.planes.find((p) => p.id === 'design')!;
    const governance = model.planes.find((p) => p.id === 'governance')!;
    const cross = model.planes.find((p) => p.id === 'cross-cutting')!;
    expect(design.files).toContain('design/domain.schema.yaml');
    expect(governance.files).toContain('governance/decisions.schema.yaml');
    expect(cross.files).toContain('metamodel.schema.yaml');
  });

  it('extracts typed-ID vocabulary with prefixes', () => {
    const byName = new Map(model.entityTypes.map((e) => [e.name, e]));
    expect(byName.get('concept_ref')?.idPrefix).toBe('CN');
    expect(byName.get('command_ref')?.idPrefix).toBe('CMD');
    expect(byName.get('event_ref')?.idPrefix).toBe('EVT');
  });

  it('extracts root requiredness, properties, and enums', () => {
    const domain = model.files.find((f) => f.relPath === 'design/domain.schema.yaml')!;
    expect(domain.required).toContain('operations');
    const operation = domain.definitions.find((d) => d.name === 'operation')!;
    expect(operation.kind).toBe('object');
    expect(operation.required).toContain('id');
    const kind = operation.properties.find((p) => p.name === 'kind')!;
    expect(kind.enumValues).toEqual(expect.arrayContaining(['command', 'event', 'query', 'document']));
  });

  it('resolves typed-ID refs to their entity type', () => {
    const domain = model.files.find((f) => f.relPath === 'design/domain.schema.yaml')!;
    const operation = domain.definitions.find((d) => d.name === 'operation')!;
    const idProp = operation.properties.find((p) => p.name === 'id')!;
    expect(idProp.type.refEntityType).toBe('operation_ref');
  });

  it('produces cross-file relations with source-true addresses', () => {
    expect(model.relations.length).toBeGreaterThan(0);
    const toMetamodel = model.relations.filter((r) => r.toFile === 'metamodel.schema.yaml');
    expect(toMetamodel.length).toBeGreaterThan(3);
    const domain = model.files.find((f) => f.relPath === 'design/domain.schema.yaml')!;
    expect(domain.source).toEqual({ version: 'v2.7', file: 'design/domain.schema.yaml', pointer: '' });
  });
});
