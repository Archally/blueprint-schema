import { statSync } from 'node:fs';

// Canonical rules and published rules sit at different depths beside model-builder.
const helperURLs = [
  new URL('../model-builder/dist/extraction/relations/featureUserStories.js', import.meta.url),
  new URL('../../model-builder/dist/extraction/relations/featureUserStories.js', import.meta.url),
];
const helperURL = helperURLs.find(url => statSync(url, { throwIfNoEntry: false })?.isFile());
if (!helperURL) {
  throw new Error(
    'Build the model-builder before loading feature-user-stories rules ' +
    '(monorepo: npm run build --workspace=@archally/blueprint-model-builder; ' +
    'public tree: npx tsc -p tools/model-builder/tsconfig.json). ' +
    `No built comparison helper found. Tried: ${helperURLs.map(url => url.href).join(', ')}`,
  );
}
// An existing helper's import errors must remain visible, rather than trigger a fallback.
const { compareFeatureUserStories } = await import(helperURL.href);
if (typeof compareFeatureUserStories !== 'function') {
  throw new TypeError(`${helperURL.href} must export compareFeatureUserStories as a function.`);
}

const cache = new WeakMap();

function comparison(model) {
  let result = cache.get(model);
  if (result) return result;
  result = compareFeatureUserStories(model.entities, model.relations.map(relation => ({
    ...relation,
    source_entity_id: relation.source,
    target_entity_id: relation.target,
  })));
  cache.set(model, result);
  return result;
}

function named(model, handle) {
  const entity = model.entities.find(entity => entity.id === handle);
  const identifier = entity?.data?.id ?? entity?.displayId ?? handle;
  const name = entity?.data?.name ?? entity?.data?.goal ?? entity?.name ?? entity?.term ?? 'unnamed declaration';
  return `${identifier} (${name})`;
}

export function featureStoryExclusive(model, subject) {
  const owners = comparison(model).ownersByStory.get(subject.id);
  if (!owners) return { ok: true };
  if (owners.size < 2) return { ok: true };
  return {
    ok: false,
    context: {
      story: named(model, subject.id),
      features: [...owners].sort().map(handle => named(model, handle)).join(', '),
    },
  };
}

export function featureStoryMismatch(model, subject) {
  const result = comparison(model);
  const mismatch = result.mismatches.find(entry => entry.featureId === subject.id);
  const unresolved = result.referenceIssues.filter(entry => entry.featureId === subject.id);
  const details = [];
  if (mismatch) {
    if (mismatch.statedOnly.length > 0) {
      details.push(`stated only: ${mismatch.statedOnly.map(handle => named(model, handle)).join(', ')}`);
    }
    if (mismatch.derivedOnly.length > 0) {
      details.push(`operation-derived only: ${mismatch.derivedOnly.map(handle => named(model, handle)).join(', ')}`);
    }
  }
  for (const issue of unresolved) {
    const candidates = issue.resolution.status === 'ambiguous'
      ? `: ${issue.resolution.handles.map(handle => named(model, handle)).join(', ')}`
      : ' (no declared UserStory)';
    details.push(`${issue.resolution.status} story reference ${issue.reference}${candidates}`);
  }
  if (details.length === 0) return { ok: true };
  return {
    ok: false,
    context: { feature: named(model, subject.id), differences: details.join('; ') },
  };
}
