/** Schema-aware raw declaration inventory. Node I/O stays outside the census kernel. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { typedIdOf } from './collect.mjs';
import { evidenceItems } from './evidence-census.mjs';

const aliases = { org: 'organization', ui: 'interactions', rg: 'infrastructure' };
const relationTypes = new Set(['dependency', 'infra_relation_edge', 'exchange', 'binding', 'service_need', 'server', 'server_entry', 'association']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
function evidencePositions(data, location) {
  return ['evidence', 'provenance/evidence'].flatMap(field => {
    const items = field === 'evidence' ? data?.evidence : data?.provenance?.evidence;
    return Array.isArray(items) ? items.flatMap((item, index) => record(item)
      ? [{ path: `${location}/${field}/${index}`, item }] : []) : [];
  });
}

const hash = value => createHash('sha256').update(value).digest('hex');

export function fileSetIdentity(documents, modelRoot) {
  return `sha256:${hash(JSON.stringify(documents.map(document => [
    path.relative(modelRoot, document.file).split(path.sep).join('/'), hash(fs.readFileSync(document.file)),
  ]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)))}`;
}

export function loadEvidenceSchemas(schemaRoot) {
  const documents = new Map();
  const roots = new Map();
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file);
      }
      if (entry.isFile() && entry.name.endsWith('.schema.yaml')) {
        documents.set(file, YAML.parse(fs.readFileSync(file, 'utf8')));
        roots.set(entry.name.replace('.schema.yaml', ''), file);
      }
    }
  };
  if (schemaRoot) {
    walk(fs.existsSync(path.join(schemaRoot, 'schema')) ? path.join(schemaRoot, 'schema') : schemaRoot);
  }
  return { documents, roots };
}

function applicable(schema, value) {
  if (!record(schema)) {
    return false;
  }
  if (schema.const !== undefined && value !== schema.const) {
    return false;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return false;
  }
  if (schema.type === 'array' && !Array.isArray(value)) {
    return false;
  }
  if (schema.type === 'object' && !record(value)) {
    return false;
  }
  if (schema.type === 'string' && typeof value !== 'string') {
    return false;
  }
  return !schema.required || (record(value) && schema.required.every(key => Object.hasOwn(value, key)));
}

/** Resolve references/composition while retaining each property's defining file. */
function shape(schema, file, schemas, value, seen = new Set()) {
  if (!record(schema)) {
    return { properties: {}, type: null };
  }
  const result = { ...schema, properties: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, node]) => [key, { node, file }])) };
  const merge = part => {
    Object.assign(result, { ...part, properties: { ...result.properties, ...part.properties } });
  };
  if (schema.$ref) {
    const [relative, fragment = ''] = schema.$ref.split('#');
    const targetFile = relative ? path.resolve(path.dirname(file), relative) : file;
    const identity = `${targetFile}#${fragment}`;
    if (!seen.has(identity)) {
      let node = schemas.documents.get(targetFile);
      for (const key of fragment.split('/').filter(Boolean)) {
        node = node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      merge(shape(node, targetFile, schemas, value, new Set([...seen, identity])));
      result.definition = fragment.split('/').at(-1);
      result.definitionFile = targetFile;
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    for (const branch of schema[keyword] ?? []) {
      if (keyword === 'allOf' || applicable(branch, value)) {
        merge(shape(branch, file, schemas, value, seen));
      }
    }
  }
  return result;
}

export function inventoryEvidence(documents, modelRoot, schemas, selection = {}) {
  const entities = [];
  const relations = [];
  const exclusions = [];
  const evidenceDeclarations = [];
  const schemaTypes = {};
  const selected = (row, relation = false) => (!selection.slice || row.slice === selection.slice)
    && (!selection.type || row.type === selection.type)
    && (!selection.family || !relation || row.family === selection.family)
    && (!selection.file || row.file === selection.file)
    && (!selection.files || selection.files.includes(row.file))
    && (!selection.entityIds || selection.entityIds.includes(row.declarationId));
  for (const document of documents) {
    const relativeFile = path.relative(modelRoot, document.file).split(path.sep).join('/');
    const kind = path.basename(document.file).replace(/\.ya?ml$/, '').split('.').at(-1);
    const schemaFile = schemas.roots.get(aliases[kind] ?? kind);
    if (!schemaFile) {
      exclusions.push({ file: relativeFile, reason: 'no-routed-schema' });
      continue;
    }
    const walk = (value, node, file, location, owner, enclosingRelation = false, depth = 0, companion) => {
      if (depth > 100 || value == null) {
        return;
      }
      const resolved = shape(node, file, schemas, value);
      const properties = resolved.properties;
      const type = resolved.definition ?? 'inline-object';
      const carrier = properties.provenance || properties.evidence ? 'capable' : 'none';
      schemaTypes[type] = carrier;
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, resolved.items, resolved.definitionFile ?? file, `${location}/${index}`, owner, enclosingRelation, depth + 1, companion));
        return;
      }
      if (record(value) && (properties.evidence || properties.provenance)) {
        evidenceDeclarations.push({ file: relativeFile, path: location, evidencePositions: evidencePositions(value, location) });
      }
      const idKey = properties.id ? 'id' : properties['x-model-id'] ? 'x-model-id' : null;
      const id = record(value) && idKey ? typedIdOf(value[idKey]) : null;
      const own = id ? { id, name: value.name ?? value.title ?? value.term ?? value.statement ?? id, evidence: evidenceItems(value) } : owner;
      const make = (data, family = type) => ({
        id: `${relativeFile}#${location}`, declarationId: id ?? own?.id ?? null,
        name: data.name ?? data.title ?? data.term ?? data.statement ?? own?.name ?? `${family} at ${location}`,
        type, family, slice: document.slice ?? '(root)', file: relativeFile, path: location,
        carrier, evidence: evidenceItems(data), evidencePositions: evidencePositions(data, location), supportingEvidence: owner?.evidence ?? [],
        certainty: data.provenance?.certainty ?? data.certainty ?? null,
        discoveryStage: data.provenance?.discovery_stage ?? data.discovery_stage ?? null,
        codeRefCount: Array.isArray(data.code_refs) ? data.code_refs.length : 0,
        origin: 'declared',
      });
      if (id) {
        const row = make(value);
        if (['inquiry', 'question', 'assumption'].includes(type)) {
          row.open = typeof value.status === 'string' ? !['closed', 'resolved', 'answered', 'validated', 'rejected'].includes(value.status)
            : type === 'question' ? !(value.answered_by?.length > 0) : null;
        }
        if (selected(row)) {
          entities.push(row);
        }
      }
      const isRelation = record(value) && relationTypes.has(type);
      if (isRelation) {
        const row = make(value);
        if (selected(row, true)) {
          relations.push(row);
        }
      }
      if (!record(value)) {
        if (!enclosingRelation && typeof value === 'string' && (companion || /_ref$/.test(type)) && !['id', 'x-model-id'].includes(location.split('/').at(-1))) {
          const provenance = companion?.entries?.[value];
          const row = { ...make({ provenance }), carrier: companion ? 'capable' : 'none', target: value,
            evidencePositions: companion ? evidencePositions({ evidence: provenance?.evidence }, `${companion.location}/${pointer(value)}`) : [] };
          if (selected(row, true)) {
            relations.push(row);
          }
        }
        return;
      }
      const companionProperty = properties.link_provenance;
      const companionFields = companionProperty ? shape(companionProperty.node, companionProperty.file, schemas, value.link_provenance).properties : {};
      for (const key of Object.keys(companionFields)) {
        for (const [target, provenance] of Object.entries(value.link_provenance?.[key] ?? {})) {
          const companionLocation = `${location}/link_provenance/${pointer(key)}/${pointer(target)}`;
          evidenceDeclarations.push({ file: relativeFile, path: companionLocation,
            evidencePositions: evidencePositions({ evidence: provenance?.evidence }, companionLocation) });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        // Evidence and companions are record metadata, never new typed entity declarations.
        if (properties[key] && ['provenance', 'evidence', 'code_refs', 'link_provenance'].includes(key)) {
          continue;
        }
        const definition = properties[key];
        const extra = resolved.additionalProperties;
        if (definition || record(extra)) {
          walk(child, definition?.node ?? extra, definition?.file ?? resolved.definitionFile ?? file,
            `${location}/${pointer(key)}`, own, enclosingRelation || isRelation, depth + 1,
            companionFields[key] ? { entries: value.link_provenance?.[key], location: `${location}/link_provenance/${pointer(key)}` } : undefined);
        }
      }
    };
    walk(document.doc, schemas.documents.get(schemaFile), schemaFile, '', null);
  }
  return { entities, relations, exclusions, schemaTypes, evidenceDeclarations };
}

/** One item per physical evidence position, even if a declaration belongs to both populations. */
export function inventoryFreshnessItems(inventory) {
  const items = new Map();
  for (const declaration of [...(inventory.evidenceDeclarations ?? []), ...inventory.entities, ...inventory.relations]) {
    for (const position of declaration.evidencePositions ?? []) {
      const identity = `${declaration.file}#${position.path}`;
      if (!items.has(identity)) {
        items.set(identity, { identity, file: declaration.file, declaration: declaration.path,
          position: position.path, item: position.item });
      }
    }
  }
  return [...items.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}
