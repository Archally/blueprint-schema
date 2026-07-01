/**
 * Atlas generation orchestrator — builds the full output file set for a version
 * (plus the cross-version changelog) as an in-memory map. The CLI writes it or
 * checks it against disk; keeping generation pure makes drift detection trivial.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { AtlasModel } from './types.js';
import { PolicyReporter } from './policy.js';
import { buildAtlasModel } from './introspect.js';
import { resolveSchemaDir } from './schema-io.js';
import { loadOverlays, indexOverlays } from './overlay.js';
import { diffModels, type RenameAnnotation } from './diff.js';
import { type GenContext } from './generate/context.js';
import { renderOverview } from './generate/overview.js';
import { renderLayerMap } from './generate/layer-map.js';
import { renderEntityCatalog } from './generate/entity-catalog.js';
import { renderRelationships } from './generate/relationships.js';
import { renderExamples } from './generate/examples.js';
import { renderChangelog } from './generate/changelog.js';
import { renderIndex } from './generate/index.js';

export interface GenerateOptions {
  repoRoot: string;
  /** Repo-relative base where schema versions live (default `schema`). */
  schemaBase: string;
  /** Current version slug, e.g. `v2.7`. */
  version: string;
  /** Previous version for the changelog diff path, e.g. `v2.6`. */
  prevVersion?: string;
  /** Overlay directory (absolute or repo-relative). */
  overlaysDir?: string;
  includeMermaid: boolean;
  includeExamples: boolean;
}

export interface GenerateResult {
  /** Output path (relative to the Atlas out dir) → file content. */
  files: Map<string, string>;
  policy: PolicyReporter;
}

function schemaDirFor(opts: GenerateOptions, version: string): string {
  return resolveSchemaDir(path.join(opts.repoRoot, opts.schemaBase, version));
}

export function generateAtlas(opts: GenerateOptions): GenerateResult {
  const policy = new PolicyReporter();
  const files = new Map<string, string>();

  let currentModel: AtlasModel;
  try {
    currentModel = buildAtlasModel(opts.version, schemaDirFor(opts, opts.version));
  } catch (err) {
    policy.fail('schema-unreadable', `Cannot build model for ${opts.version}: ${(err as Error).message}`);
    return { files, policy };
  }

  const overlays = loadOverlays(
    opts.overlaysDir ? path.resolve(opts.repoRoot, opts.overlaysDir) : undefined,
    opts.version,
    policy,
  );
  const overlayIndex = indexOverlays(overlays);
  const ctx: GenContext = { model: currentModel, overlayIndex, policy };

  const v = opts.version;
  files.set(`${v}/overview.md`, renderOverview(ctx, opts.includeMermaid));
  files.set(`${v}/layer-map.md`, renderLayerMap(ctx, opts.includeMermaid));
  files.set(`${v}/entity-catalog.md`, renderEntityCatalog(ctx));
  files.set(`${v}/relationships.md`, renderRelationships(ctx));

  if (opts.includeExamples) {
    files.set(`${v}/examples.md`, renderExamples(ctx, opts.repoRoot));
  } else {
    policy.skip('examples-disabled', 'Examples page disabled via --no-examples.');
  }

  // Changelog (needs a previous version).
  const versions = [v];
  if (opts.prevVersion) {
    const prevDir = schemaDirFor(opts, opts.prevVersion);
    if (fs.existsSync(prevDir)) {
      try {
        const prevModel = buildAtlasModel(opts.prevVersion, prevDir);
        const renames: RenameAnnotation[] = overlays
          .flatMap((o) => o.entries.map((e) => ({ e, id: o.id })))
          .filter((x) => x.e.category === 'rename-annotation' && x.e.renamedFrom)
          .map((x) => ({
            renamedFrom: x.e.renamedFrom!,
            target: x.e.target,
            basis: `explicitly annotated (overlay \`${x.id}\`)`,
            note: x.e.note,
          }));
        const diff = diffModels(prevModel, currentModel, renames, policy);
        files.set('changelog.md', renderChangelog(ctx, diff));
        versions.push(opts.prevVersion);
      } catch (err) {
        policy.warn('changelog-skipped', `Could not build ${opts.prevVersion} for diff: ${(err as Error).message}`);
      }
    } else {
      policy.skip('changelog-prev-absent', `Previous version dir not found (${prevDir}); changelog omitted.`);
    }
  } else {
    policy.skip('changelog-no-prev', 'No --prev version supplied; changelog omitted.');
  }

  files.set('README.md', renderIndex({ current: currentModel, versions }));

  return { files, policy };
}
