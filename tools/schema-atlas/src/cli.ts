#!/usr/bin/env node
/**
 * Blueprint Schema Atlas CLI (Step 06).
 *
 *   blueprint-atlas generate   # regenerate docs/schema-atlas/**
 *   blueprint-atlas check      # drift check — fail if generated output is stale
 *
 * Exit codes: 0 = ok · 1 = drift (check mode) · 2 = generation failure (fail policy).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { generateAtlas, type GenerateOptions } from './render.js';
import { walkFiles, toPosixPath } from './schema-io.js';

interface CliOptions extends GenerateOptions {
  mode: 'generate' | 'check';
  outDir: string;
}

const HELP = [
  'Usage: blueprint-atlas <generate|check> [options]',
  '',
  'Generate (or verify) the Blueprint Schema Atlas — a human-readable projection of the JSON Schema.',
  '',
  'Modes:',
  '  generate           Write the Atlas to the output directory (default)',
  '  check              Verify on-disk Atlas matches a fresh generation (drift detection)',
  '',
  'Options:',
  '  --version <v>      Current schema version slug (default: v2.8)',
  '  --prev <v>         Previous version for the changelog diff (default: v2.6)',
  '  --out <dir>        Output directory, repo-relative (default: docs/schema-atlas)',
  '  --schema-base <d>  Base dir holding schema versions (default: schema)',
  '  --overlays <dir>   Overlay directory (default: tools/schema-atlas/overlays)',
  '  --repo-root <dir>  Repository root (default: current working directory)',
  '  --no-mermaid       Omit Mermaid diagrams',
  '  --no-examples      Omit the examples page',
  '  --help, -h         Show this help',
].join('\n');

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    mode: 'generate',
    repoRoot: process.cwd(),
    schemaBase: 'schema',
    version: 'v2.8',
    prevVersion: 'v2.6',
    overlaysDir: 'tools/schema-atlas/overlays',
    includeMermaid: true,
    includeExamples: true,
    outDir: 'docs/schema-atlas',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === 'generate' || a === 'check') opts.mode = a;
    else if (a === '--version') opts.version = argv[++i]!;
    else if (a === '--prev') opts.prevVersion = argv[++i]!;
    else if (a === '--out') opts.outDir = argv[++i]!;
    else if (a === '--schema-base') opts.schemaBase = argv[++i]!;
    else if (a === '--overlays') opts.overlaysDir = argv[++i]!;
    else if (a === '--repo-root') opts.repoRoot = path.resolve(argv[++i]!);
    else if (a === '--no-mermaid') opts.includeMermaid = false;
    else if (a === '--no-examples') opts.includeExamples = false;
    else if (a === '--no-prev') opts.prevVersion = undefined;
    else if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const outAbs = path.resolve(opts.repoRoot, opts.outDir);

  const { files, policy } = generateAtlas(opts);

  console.log(policy.render());

  if (policy.hasFailures()) {
    console.error('\n✖ Atlas generation FAILED (truth-threatening condition). No files written.');
    process.exit(2);
  }

  if (opts.mode === 'check') {
    const drift: string[] = [];
    for (const [rel, content] of files) {
      const abs = path.join(outAbs, rel);
      if (!fs.existsSync(abs)) {
        drift.push(`missing: ${rel}`);
      } else if (normalize(fs.readFileSync(abs, 'utf8')) !== normalize(content)) {
        drift.push(`stale:   ${rel}`);
      }
    }
    // Detect on-disk generated files no longer produced.
    if (fs.existsSync(outAbs)) {
      const expected = new Set(files.keys());
      const onDisk = walkFiles(outAbs, (f) => /\.md$/i.test(f)).map((f) => toPosixPath(path.relative(outAbs, f)));
      for (const f of onDisk) if (!expected.has(f)) drift.push(`orphan:  ${f}`);
    }

    if (drift.length > 0) {
      console.error(`\n✖ Atlas is out of date (${drift.length}):`);
      for (const d of drift.sort()) console.error(`   ${d}`);
      console.error('\nRun `npm run atlas` to regenerate.');
      process.exit(1);
    }
    console.log(`\n✓ Atlas is up to date (${files.size} files).`);
    process.exit(0);
  }

  // generate mode — write files.
  let written = 0;
  for (const [rel, content] of files) {
    const abs = path.join(outAbs, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const next = normalize(content);
    const prev = fs.existsSync(abs) ? normalize(fs.readFileSync(abs, 'utf8')) : null;
    if (prev !== next) {
      fs.writeFileSync(abs, next, 'utf8');
      written++;
    }
  }
  console.log(`\n✓ Atlas generated: ${files.size} files (${written} changed) → ${opts.outDir}/`);
  process.exit(0);
}

main();
