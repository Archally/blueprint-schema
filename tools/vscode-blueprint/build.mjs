#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
// The publication layout carries the same authoritative tool, not an editable vendored copy.
const candidates = [
  resolve(directory, '../../../schemas/blueprint/.shared/validator'),
  resolve(directory, '../validator/src'),
];
const validator = candidates.find(candidate => existsSync(join(candidate, 'core/cross-references.mjs')));
if (!validator) throw Error(`Authoritative Apache validator source unavailable. Looked in: ${candidates.join(', ')}`);
const require = createRequire(import.meta.url);
const { build, context } = require('esbuild');
const options = {
  absWorkingDir: directory,
  entryPoints: ['src/extension.ts', 'src/diagnostics.ts'],
  outdir: 'out', bundle: true, platform: 'node', format: 'cjs', target: 'node16',
  external: ['vscode'], sourcemap: 'external', sourcesContent: false, metafile: true,
  logLevel: 'silent',
  plugins: [{ name: 'authoritative-validator', setup(builder) {
    builder.onResolve({ filter: /^@archally-blueprint-validator\// }, args => {
      const suffix = args.path.slice('@archally-blueprint-validator/'.length);
      return { path: join(validator, suffix) };
    });
    builder.onEnd(result => {
      if (result.metafile) {
        writeFileSync(join(directory, 'out/bundle-meta.json'), JSON.stringify(result.metafile, null, 2) + '\n');
        const dependencies = new Map();
        for (const input of Object.keys(result.metafile.inputs)) {
          const match = [...input.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)].at(-1);
          if (!match) continue;
          const root = resolve(directory, input.slice(0, match.index + match[0].length));
          const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
          const license = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license'].find(name => existsSync(join(root, name)));
          if (!license) throw Error(`Missing license for bundled dependency ${metadata.name}`);
          dependencies.set(metadata.name, `${metadata.name} ${metadata.version} (${metadata.license})\n\n${readFileSync(join(root, license), 'utf8')}`);
        }
        writeFileSync(join(directory, 'THIRD-PARTY-LICENSES.txt'),
          'Generated from the bundle dependency graph. Rebuild to refresh.\n\n' +
          [...dependencies].sort(([left], [right]) => left.localeCompare(right)).map(([, license]) => license).join('\n\n') + '\n');
      }
      for (const error of result.errors) console.error(error.text);
    });
  } }],
};
if (process.argv.includes('--watch')) {
  const session = await context(options);
  await session.watch();
  console.log('Watching extension and validator sources.');
} else {
  await build(options);
}
