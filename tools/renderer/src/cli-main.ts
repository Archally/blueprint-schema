import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { BlueprintModel, DocumentsBySchemaType } from '../../model-builder/dist/model/types.js';
import { renderBlueprint } from './render.js';

/**
 * Reading files off disk and assembling a `BlueprintModel` are the two things the extraction
 * pipeline deliberately leaves to its caller, so the entry point supplies them. Injecting them here
 * keeps argument parsing, option handling and output formatting independent of where the model
 * came from — and lets the renderer be driven from an already-loaded model in a test.
 */
export interface RenderCliDeps {
  loadFromDirectory(blueprintDirectory: string): { documentsByType: DocumentsBySchemaType };
  buildBlueprintModel(documentsByType: DocumentsBySchemaType): BlueprintModel;
}

export function runRenderCli(args: string[], deps: RenderCliDeps): void {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log([
      'Usage: blueprint-render <blueprint-dir> [options]',
      '',
      'Render a blueprint model as markdown with embedded Mermaid diagrams.',
      '',
      'Arguments:',
      '  <blueprint-dir>    Path to .blueprint/v{N} directory',
      '',
      'Options:',
      '  --output, -o       Output file path (default: stdout)',
      '  --title, -t        Report title',
      '  --no-mermaid       Omit Mermaid diagrams',
      '  --no-relations     Omit relation table',
      '  --no-gaps          Omit coverage gaps',
      '  --check            Compare against --output instead of writing; exit 1 if it differs',
      '  --help, -h         Show this help message',
      '',
      'Examples:',
      '  blueprint-render .blueprint/v2.6 -o .specs/overview.md',
      '  blueprint-render .blueprint/v2.6 --no-mermaid',
      '  blueprint-render .blueprint/v2.6 -o .specs/overview.md --check',
    ].join('\n'));
    process.exit(0);
  }

  let blueprintDir: string | undefined;
  let output: string | undefined;
  let title: string | undefined;
  let includeMermaid = true;
  let includeRelations = true;
  let includeGaps = true;
  let check = false;

  for (let i = 0; i < args.length; i++) {
    const argument = args[i]!;
    if ((argument === '--output' || argument === '-o') && args[i + 1]) {
      output = args[++i];
    } else if ((argument === '--title' || argument === '-t') && args[i + 1]) {
      title = args[++i];
    } else if (argument === '--no-mermaid') {
      includeMermaid = false;
    } else if (argument === '--no-relations') {
      includeRelations = false;
    } else if (argument === '--no-gaps') {
      includeGaps = false;
    } else if (argument === '--check') {
      check = true;
    } else if (!argument.startsWith('-')) {
      blueprintDir = argument;
    }
  }

  if (!blueprintDir) {
    console.error('Error: blueprint directory argument required');
    process.exit(1);
  }

  const resolvedDir = path.resolve(blueprintDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`Error: directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  const loaded = deps.loadFromDirectory(resolvedDir);
  const model = deps.buildBlueprintModel(loaded.documentsByType);
  const markdown = renderBlueprint(model, { includeMermaid, includeRelations, includeGaps, title });

  // A rendered report is DERIVED from the model beside it, so the two can disagree only by being
  // regenerated at different times — and a report whose headline count contradicts its own model is
  // worse than no report. `--check` makes that difference an exit code instead of something a reader
  // has to notice. Rendering is deterministic, so a clean check is a real guarantee, not a sample.
  if (check) {
    if (!output) {
      console.error('Error: --check requires --output');
      process.exit(1);
    }
    const outputPath = path.resolve(output);
    if (!fs.existsSync(outputPath)) {
      console.error(`Error: --check target does not exist: ${outputPath}`);
      process.exit(1);
    }
    const existing = fs.readFileSync(outputPath, 'utf8');
    if (existing.replace(/\r\n/g, '\n') === markdown.replace(/\r\n/g, '\n')) {
      console.log(`Up to date: ${outputPath} (${model.entities.length} entities, ${model.relations.length} relations)`);
      return;
    }
    console.error(`STALE: ${outputPath} does not match the model it describes.`);
    console.error(`  Model now: ${model.entities.length} entities, ${model.relations.length} relations`);
    console.error('  Regenerate it by running the same command without --check.');
    process.exit(1);
  }

  if (output) {
    const outputPath = path.resolve(output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, markdown, 'utf8');
    console.log(`Written to ${outputPath}`);
    console.log(`  Entities:  ${model.entities.length}`);
    console.log(`  Relations: ${model.relations.length}`);
  } else {
    process.stdout.write(markdown);
  }
}
