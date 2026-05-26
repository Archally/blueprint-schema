#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadFromDirectory } from './loader-fs.js';
import { buildBlueprintModel } from './model/buildModel.js';

function printHelp() {
  console.log(
    [
      'Usage: blueprint-model <blueprint-dir> [--output <path>] [--pretty]',
      '',
      'Loads blueprint YAML files and produces a model.json.',
      '',
      'Arguments:',
      '  <blueprint-dir>    Path to .blueprint/v2.7 directory',
      '',
      'Options:',
      '  --output, -o   Write to file instead of stdout',
      '  --pretty, -p   Pretty-print JSON (2-space indent)',
      '  --help, -h     Show this help',
    ].join('\n'),
  );
}

function main() {
  const args = process.argv.slice(2);
  let blueprintDir: string | undefined;
  let outputPath: string | undefined;
  let pretty = false;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else if ((token === '--output' || token === '-o') && args[i + 1]) {
      outputPath = path.resolve(args[i + 1]);
      i++;
    } else if (token === '--pretty' || token === '-p') {
      pretty = true;
    } else if (!token.startsWith('-')) {
      blueprintDir = path.resolve(token);
    }
  }

  if (!blueprintDir) {
    blueprintDir = path.resolve('.blueprint/v2.7');
  }

  console.error(`Loading: ${blueprintDir}`);

  const { documentsByType } = loadFromDirectory(blueprintDir);
  const model = buildBlueprintModel(documentsByType);

  console.error(`Entities: ${model.entities.length}`);
  console.error(`Relations: ${model.relations.length}`);

  const json = JSON.stringify(model, null, pretty ? 2 : undefined);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json, 'utf8');
    console.error(`Written: ${outputPath}`);
  } else {
    process.stdout.write(json);
  }
}

main();
