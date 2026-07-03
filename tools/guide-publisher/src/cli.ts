#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { checkPdfOutputs, renderGuideSet, writeBuildOutputs, writePdfOutputs, type PublisherOptions } from './core.js';

type Mode = 'build' | 'pdf' | 'check';

interface CliOptions extends PublisherOptions {
  mode: Mode;
}

const HELP = [
  'Usage: blueprint-guides <build|pdf|check> [options]',
  '',
  'Build preview HTML and committed PDFs for docs/handoff-guides/markdown.',
  '',
  'Modes:',
  '  build              Write preview HTML to docs/handoff-guides/markdown/.build',
  '  pdf                Write preview HTML and committed PDFs to docs/handoff-guides/pdf',
  '  check              Verify committed PDFs + manifest are current and links are valid',
  '',
  'Options:',
  '  --repo-root <dir>  Repository root (default: current working directory)',
  '  --source <dir>     Source guide directory (default: docs/handoff-guides/markdown)',
  '  --build <dir>      Preview HTML directory (default: docs/handoff-guides/markdown/.build)',
  '  --pdf <dir>        PDF output directory (default: docs/handoff-guides/pdf)',
  '  --browser <path>   Browser executable for PDF rendering',
  '  --help, -h         Show this help',
].join('\n');

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    mode: 'build',
    repoRoot: process.cwd(),
    sourceDir: 'docs/handoff-guides/markdown',
    buildDir: 'docs/handoff-guides/markdown/.build',
    pdfDir: 'docs/handoff-guides/pdf',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === 'build' || arg === 'pdf' || arg === 'check') opts.mode = arg;
    else if (arg === '--repo-root') opts.repoRoot = path.resolve(argv[++i]!);
    else if (arg === '--source') opts.sourceDir = argv[++i]!;
    else if (arg === '--build') opts.buildDir = argv[++i]!;
    else if (arg === '--pdf') opts.pdfDir = argv[++i]!;
    else if (arg === '--browser') opts.browserPath = argv[++i]!;
    else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const rendered = renderGuideSet(opts);

  if (rendered.linkErrors.length > 0) {
    console.error(`✖ Guide generation blocked by ${rendered.linkErrors.length} broken link(s):`);
    for (const issue of rendered.linkErrors) console.error(`   ${issue}`);
    process.exit(2);
  }

  if (opts.mode === 'check') {
    const issues = checkPdfOutputs(opts, rendered);
    if (issues.length > 0) {
    console.error(`✖ Handoff guide PDFs are out of date (${issues.length}):`);
      for (const issue of issues) console.error(`   ${issue}`);
      console.error('\nRun `npm run guides:pdf` to regenerate the committed PDFs.');
      process.exit(1);
    }
    console.log(`✓ Handoff guide PDFs are up to date (${rendered.guides.length} guides).`);
    return;
  }

  writeBuildOutputs(opts, rendered);
  console.log(`✓ Guide HTML built: ${rendered.guides.length} file(s) → ${opts.buildDir}`);

  if (opts.mode === 'pdf') {
    await writePdfOutputs(opts, rendered);
    console.log(`✓ Guide PDFs generated: ${rendered.guides.length} file(s) → ${opts.pdfDir}`);
  }
}

main().catch((error: unknown) => {
  console.error(`✖ Guide publisher failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});