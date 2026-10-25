/**
 * Give an entity a migration adds the shape the build gives the same entity declared in a file.
 *
 * The build does two things to an entity that the migration's `after:` block does not state. It keys
 * an arch entity (a context, a service) by its NAME, with the declared `BC###`/`SVC###`
 * kept as `data.id`, which is what a `bounded_context_ref` resolves against. And it writes the
 * document the entity sits in onto the entity: `_scope` and `_context_name` from a domain file's
 * header, `_root` or `_party` from where an arch file nests a context, and the file-level defaults
 * (`owned_by`, `domain_ref`, `system_ref`) under their `_..._default` keys. Relations are derived
 * from both, so an entity added without them is drawn differently from the same entity written into
 * a file: no owner, no system, a question scoped to nothing.
 *
 * A migration names no file. The file is the one its siblings sit in: entities of the same type in
 * the same slice (the scope prefix of a domain id), contexts placed the same way, services of the
 * same context. A document key is taken only when every sibling carries it with the same value, so
 * a slice whose files disagree passes on nothing it cannot be sure of. An entity with no siblings
 * gets no document keys.
 *
 * The file itself is the build's third input: an operation's folder names its domain, and an arch
 * file nests a service in the context declared beside it. The entity keeps the migration's path as
 * its `fileOrigin`, since that is where it is declared, and records under `_written_in` the file the
 * relation build reads it from instead (see `rederiveRelations.ts`):
 *
 * - a service: the file of the context it names, which is where a file nests it;
 * - any other entity: the one file all its siblings sit in, else, when they share one folder, a file
 *   of the migration's own name in that folder, as a migration written out becomes a new file there.
 *
 * Where neither holds, nothing is recorded and the entity is read where it is declared.
 */
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { OWNED_BY_DEFAULT } from '../../extraction/entities/ownershipDefaults.js';
import { DOMAIN_REF_DEFAULT } from '../../extraction/entities/domainDefaults.js';
import { SYSTEM_REF_DEFAULT } from '../../extraction/entities/systemDefaults.js';

/**
 * Migration entity kinds the arch extractor keys by name rather than by declared id. Not `party`:
 * that kind adds an org-layer party, which the org extractor keys by its id.
 */
const KEYED_BY_NAME: ReadonlySet<string> = new Set(['context', 'service', 'dependency']);

/** The keys a document writes onto every entity it declares in one place. */
const DOCUMENT_KEYS = ['_scope', '_context_name', '_root', '_party', OWNED_BY_DEFAULT, DOMAIN_REF_DEFAULT, SYSTEM_REF_DEFAULT] as const;

/** The file the relation build reads an entity a migration adds from, when it differs from its `fileOrigin`. */
export const WRITTEN_IN = '_written_in';

/** Entities the relation builder creates; they sit in no document. */
const BUILT_TYPES: ReadonlySet<string> = new Set([ENTITY_TYPE.Missing, ENTITY_TYPE.CodeFile]);

/** The graph key of an entity a migration adds: its name for an arch entity, else its declared id. */
export function declaredKeyOf(after: Record<string, unknown>, entityType: string, target: string): string {
  if (KEYED_BY_NAME.has(entityType) && typeof after.name === 'string' && after.name.length > 0) return after.name;
  return String(after.id ?? target);
}

/**
 * The data an entity holds after a migration rewrites it: the new block, with the keys its document
 * wrote kept, since the entity has not moved. A key the new block states itself wins.
 */
export function keepDocumentKeys(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(previous ?? {})) {
    if (key.startsWith('_') && !(key in next)) kept[key] = value;
  }
  return { ...next, ...kept };
}

function dataOf(entity: Entity): Record<string, unknown> {
  return (entity.data as Record<string, unknown> | undefined) ?? {};
}

function scopePrefix(displayId: string): string | null {
  const dot = displayId.indexOf('.');
  return dot > 0 ? displayId.slice(0, dot) : null;
}

function samePlacement(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return (a._party ?? null) === (b._party ?? null);
}

/** The file an entity is read from: the one it would be written into, else the one declaring it. */
export function writtenFileOf(entity: { fileOrigin?: string; data?: unknown }): string | undefined {
  const written = ((entity.data ?? {}) as Record<string, unknown>)[WRITTEN_IN];
  return typeof written === 'string' && written.length > 0 ? written : entity.fileOrigin;
}

function splitPath(path: string): { folder: string; name: string } {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? { folder: '', name: normalized } : { folder: normalized.slice(0, slash), name: normalized.slice(slash + 1) };
}

/** The context a service names, placed as the service is, when exactly one matches. */
function contextOf(service: Entity, entities: Entity[]): Entity | undefined {
  const data = dataOf(service);
  const matches = entities.filter(
    (other) =>
      other !== service &&
      other.type === ENTITY_TYPE.Context &&
      (other.term ?? other.displayId) === data._context &&
      samePlacement(dataOf(other), data),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** The file the build would read `entity` from, were it written beside its siblings. */
function writtenFile(entity: Entity, siblings: Entity[], entities: Entity[]): string | undefined {
  if (entity.type === ENTITY_TYPE.Service) {
    const context = contextOf(entity, entities);
    if (context) return writtenFileOf(context);
  }
  const files = new Set(siblings.map((sibling) => writtenFileOf(sibling) ?? ''));
  if (files.size === 1) {
    const [only] = files;
    if (only) return only;
  }
  const folders = new Set([...files].map((file) => splitPath(file).folder));
  if (folders.size !== 1) return undefined;
  const [folder] = folders;
  if (!folder) return undefined;
  return `${folder}/${splitPath(entity.fileOrigin ?? '').name || 'migration.yaml'}`;
}

/** The entities that sit where this one would be written. */
function siblingsOf(entity: Entity, entities: Entity[]): Entity[] {
  const data = dataOf(entity);
  const others = entities.filter((other) => other !== entity && !BUILT_TYPES.has(other.type));
  if (entity.type === ENTITY_TYPE.Context) {
    return others.filter((other) => other.type === ENTITY_TYPE.Context && samePlacement(dataOf(other), data));
  }
  if (entity.type === ENTITY_TYPE.Service) {
    const services = others.filter((other) => other.type === ENTITY_TYPE.Service);
    const sameContext = services.filter((other) => dataOf(other)._context === data._context && samePlacement(dataOf(other), data));
    if (sameContext.length > 0) return sameContext;
    const owner = others.find((other) => other.type === ENTITY_TYPE.Context && (other.term ?? other.displayId) === data._context);
    if (!owner) return [];
    const ownerData = dataOf(owner);
    const placedAlike = new Set(
      others
        .filter((other) => other.type === ENTITY_TYPE.Context && samePlacement(dataOf(other), ownerData) && dataOf(other)._root === ownerData._root)
        .map((other) => other.term ?? other.displayId),
    );
    return services.filter((other) => placedAlike.has(dataOf(other)._context as string));
  }
  const prefix = scopePrefix(entity.displayId);
  if (!prefix) return [];
  const inSlice = others.filter((other) => other.layer === entity.layer && scopePrefix(other.displayId) === prefix);
  const sameType = inSlice.filter((other) => other.type === entity.type);
  return sameType.length > 0 ? sameType : inSlice;
}

/**
 * Key an added entity as the build keys it and give it the document keys its siblings agree on.
 * Mutates `entity`; a key `after:` states itself is left as stated.
 */
export function placeAsWritten(entity: Entity, entities: Entity[]): void {
  const siblings = siblingsOf(entity, entities);
  const data = dataOf(entity);
  const placed: Record<string, unknown> = {};
  if (!(WRITTEN_IN in data)) {
    const file = writtenFile(entity, siblings, entities);
    if (file && file !== entity.fileOrigin) placed[WRITTEN_IN] = file;
  }
  for (const key of DOCUMENT_KEYS) {
    if (key in data) continue;
    const values = new Set(siblings.map((sibling) => JSON.stringify(dataOf(sibling)[key])));
    if (values.size !== 1) continue;
    const [only] = values;
    if (only === undefined) continue;
    placed[key] = JSON.parse(only);
  }
  if (Object.keys(placed).length > 0) entity.data = { ...data, ...placed };
}
