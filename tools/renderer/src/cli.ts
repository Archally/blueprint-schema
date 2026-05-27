import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadFromDirectory } from '../../model-builder/dist/loader-fs.js';
import { buildBlueprintModel } from '../../model-builder/dist/model/buildModel.js';
import { renderBlueprint } from './render.js';

function main() {
  const args = process.argv.slice(2);

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
      '  --help, -h         Show this help message',
      '',
      'Examples:',
      '  blueprint-render .blueprint/v2.6 -o .specs/overview.md',
      '  blueprint-render .blueprint/v2.6 --no-mermaid',
    ].join('\n'));
    process.exit(0);
  }

  let blueprintDir: string | undefined;
  let output: string | undefined;
  let title: string | undefined;
  let includeMermaid = true;
  let includeRelations = true;
  let includeGaps = true;

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

  const loaded = loadFromDirectory(resolvedDir);
  const model = buildBlueprintModel(loaded.documentsByType);
  const markdown = renderBlueprint(model, { includeMermaid, includeRelations, includeGaps, title });

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

main();
