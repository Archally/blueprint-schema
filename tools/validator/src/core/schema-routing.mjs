// GENERATED - do not edit.
// Emitted by tsc from the model builder's src/schemaTypes.ts.
// That TypeScript module is the single implementation: the model builder imports it, and this
// plain-ESM copy is what the zero-build validator runs, so the two cannot disagree. Editing this
// file makes them disagree; change the TypeScript module and regenerate this copy.

/**
 * Blueprint file routing: which schema type a model file holds, read from its file name.
 *
 * This is the one answer to "is this file part of the model, and which schema checks it?". The
 * model builder loads exactly the files `getSchemaForFile` routes and ignores every other file, so
 * a program that needs the answer reads this module instead of keeping a table of its own.
 *
 * Browser-safe: no Node.js imports, and no imports at all.
 *
 * Adding a schema type: extend V2_SCHEMA_TYPES, FILENAME_TO_SCHEMA and MULTI_FILE_PATTERN.
 * Retiring a file name: remove its type from those three and add it to RETIRED_FILE_TYPES, so a
 * file still carrying the old name is reported with the name that replaced it rather than ignored.
 */
export const V2_SCHEMA_TYPES = [
    'migration',
    'migrations',
    'concepts',
    'rules',
    'domain',
    'arch',
    'motivation',
    'decisions',
    'test-cases',
    'dynamics',
    'quality',
    'capability',
    'story',
    'models',
    'rg',
    'infrastructure',
    'org',
    'organization',
    'ui',
    'interactions',
    'roadmap',
    'value-stream',
    'leverage',
    'blueprint',
];
export const FILENAME_TO_SCHEMA = {
    'concepts.yaml': 'concepts',
    'concepts.yml': 'concepts',
    'rules.yaml': 'rules',
    'rules.yml': 'rules',
    'domain.yaml': 'domain',
    'domain.yml': 'domain',
    'arch.yaml': 'arch',
    'arch.yml': 'arch',
    'motivation.yaml': 'motivation',
    'motivation.yml': 'motivation',
    'decisions.yaml': 'decisions',
    'decisions.yml': 'decisions',
    'test-cases.yaml': 'test-cases',
    'test-cases.yml': 'test-cases',
    'dynamics.yaml': 'dynamics',
    'dynamics.yml': 'dynamics',
    'quality.yaml': 'quality',
    'quality.yml': 'quality',
    'capability.yaml': 'capability',
    'capability.yml': 'capability',
    'story.yaml': 'story',
    'story.yml': 'story',
    'models.yaml': 'models',
    'models.yml': 'models',
    'rg.yaml': 'rg',
    'rg.yml': 'rg',
    'infrastructure.yaml': 'infrastructure',
    'infrastructure.yml': 'infrastructure',
    'org.yaml': 'org',
    'org.yml': 'org',
    'organization.yaml': 'organization',
    'organization.yml': 'organization',
    'ui.yaml': 'ui',
    'ui.yml': 'ui',
    'interactions.yaml': 'interactions',
    'interactions.yml': 'interactions',
    'roadmap.yaml': 'roadmap',
    'roadmap.yml': 'roadmap',
    'value-stream.yaml': 'value-stream',
    'value-stream.yml': 'value-stream',
    'leverage.yaml': 'leverage',
    'leverage.yml': 'leverage',
    'blueprint.yaml': 'blueprint',
    'blueprint.yml': 'blueprint',
    // A migration is addressed two ways: as the model's own `migration.yaml`, and as
    // `<name>.migration.yaml` for one of several. The second is matched by the regex in
    // `getSchemaForFile`, which is why `migration` is absent from `MULTI_FILE_PATTERN` below.
    'migration.yaml': 'migration',
    'migration.yml': 'migration',
    // The register of a model's migrations, read as a history. Singular and plural are two
    // documents with two schemas, not two spellings of one.
    'migrations.yaml': 'migrations',
    'migrations.yml': 'migrations',
};
/** Multi-file pattern: {name}.{schema-type}.yaml (e.g. consumer.domain.yaml, payment.concepts.yaml). */
export const MULTI_FILE_PATTERN = /^[^/\\]+\.(concepts|rules|domain|arch|motivation|decisions|test-cases|dynamics|quality|capability|story|models|rg|infrastructure|org|organization|ui|interactions|roadmap|value-stream|leverage)\.(yaml|yml)$/i;
/**
 * Map file path to v2 schema type. Returns null for files outside the blueprint convention.
 *
 * Supports:
 *   - Exact filenames: `domain.yaml`, `concepts.yaml`, …
 *   - Multi-file pattern: `payment.domain.yaml`, `consumer.concepts.yaml`, `orders/story.yaml`
 *   - Migrations: `migration.yaml`, and `*.migration.yaml` for one of several
 */
export function getSchemaForFile(filePath) {
    const segments = filePath.replace(/\\/g, '/').split('/');
    const fileName = segments[segments.length - 1] ?? '';
    if (/\.migration\.(yaml|yml)$/i.test(fileName))
        return 'migration';
    const exact = FILENAME_TO_SCHEMA[fileName];
    if (exact)
        return exact;
    const multiMatch = fileName.match(MULTI_FILE_PATTERN);
    if (multiMatch) {
        const schemaType = multiMatch[1].toLowerCase();
        return (schemaType === 'test-cases' ? 'test-cases' : schemaType);
    }
    return null;
}
/**
 * File types the model builder no longer loads, each with the type that replaced it.
 *
 * A retired name is not in the routing table above, so nothing derived from that table can say the
 * name ever existed; this table is what lets a validator name the replacement instead of passing the
 * file over as unknown. Every form the builder loaded before the retirement is covered: the bare
 * name, `<name>.<type>`, a dot-prefixed name, either extension, and any case of the type.
 *
 * `process` was a second name for the narrative file kind; the narrative file is `story.yaml`. Only
 * the file name is retired: a narrative file is still read under both collection keys, `processes:`
 * and `stories:`.
 */
export const RETIRED_FILE_TYPES = {
    process: 'story',
};
/**
 * The retired file type a file name carries, with the name to rename it to; null for any other name.
 *
 *   - `process.yaml` -> `story.yaml`
 *   - `orders/checkout.process.yml` -> `checkout.story.yml`
 */
export function getRetiredFileName(filePath) {
    const segments = filePath.replace(/\\/g, '/').split('/');
    const fileName = segments[segments.length - 1] ?? '';
    const match = /^(?:(.+)\.)?([^./\\]+)\.(yaml|yml)$/i.exec(fileName);
    if (!match)
        return null;
    const [, prefix, type, extension] = match;
    const retiredType = type.toLowerCase();
    const replacementType = RETIRED_FILE_TYPES[retiredType];
    if (!replacementType)
        return null;
    // A bare name was loaded only when written in lower case, as every exact name is.
    if (prefix === undefined && fileName !== fileName.toLowerCase())
        return null;
    return {
        retiredType,
        replacementType,
        replacementName: `${prefix === undefined ? '' : `${prefix}.`}${replacementType}.${extension}`,
    };
}
