#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { loadFromDirectory } from '../../model-builder/dist/loader-fs.js';
import { buildBlueprintModel } from '../../model-builder/dist/model/buildModel.js';
import { runChecker } from './engine.js';
import { builtinRules } from './rules/index.js';
import type { CheckerConfig } from './types.js';

function printHelp() {
  console.log(
    [
      'Usage: blueprint-check <blueprint-dir> [--config <path>]',
      '',
      'Run semantic checks on a blueprint model.',
      '',
      'Arguments:',
      '  <blueprint-dir>    Path to .blueprint/v2.7 directory',
      '',
      'Options:',
      '  --config, -c   Path to .blueprint-lint.yaml config file',
      '  --help, -h     Show this help',
      '  --list         List available rules and exit',
      '',
      'Config file format (.blueprint-lint.yaml):',
      '  rules:',
      '    orphan-entities: warn',
      '    missing-causal-links: error',
      '    aggregate-root-signals: off',
    ].join('\n'),
  );
}

function listRules() {
  console.log('Available rules:\n');
  for (const rule of builtinRules) {
    console.log(`  ${rule.id} (default: ${rule.defaultSeverity})`);
    console.log(`    ${rule.description}\n`);
  }
}

function loadConfig(configPath: string | undefined): CheckerConfig {
  if (!configPath) {
    const defaultPaths = ['.blueprint-lint.yaml', '.blueprint-lint.yml'];
    for (const defaultPath of defaultPaths) {
      const resolved = path.resolve(defaultPath);
      if (fs.existsSync(resolved)) {
        const content = fs.readFileSync(resolved, 'utf8');
        return parseYaml(content) as CheckerConfig ?? {};
      }
    }
    return {};
  }

  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Config file not found: ${resolved}`);
    process.exit(2);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  return parseYaml(content) as CheckerConfig ?? {};
}

function main() {
  const args = process.argv.slice(2);
  let blueprintDir: string | undefined;
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else if (token === '--list') {
      listRules();
      process.exit(0);
    } else if ((token === '--config' || token === '-c') && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    } else if (!token.startsWith('-')) {
      blueprintDir = path.resolve(token);
    }
  }

  if (!blueprintDir) {
    blueprintDir = path.resolve('.blueprint/v2.7');
  }

  const config = loadConfig(configPath);

  console.log(`Model:  ${blueprintDir}`);
  console.log(`Config: ${configPath ?? '(defaults)'}`);
  console.log(`Rules:  ${builtinRules.length} loaded`);
  console.log('');

  const { documentsByType } = loadFromDirectory(blueprintDir);
  const model = buildBlueprintModel(documentsByType);

  console.log(`Entities:  ${model.entities.length}`);
  console.log(`Relations: ${model.relations.length}`);
  console.log('');

  const issues = runChecker(model, builtinRules, config);

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warn');
  const infos = issues.filter(i => i.severity === 'info');

  if (errors.length > 0) {
    console.log('Errors:');
    for (const issue of errors) {
      console.log(`  [${issue.ruleId}] ${issue.message}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const issue of warnings) {
      console.log(`  [${issue.ruleId}] ${issue.message}`);
    }
    console.log('');
  }

  if (infos.length > 0) {
    console.log('Info:');
    for (const issue of infos) {
      console.log(`  [${issue.ruleId}] ${issue.message}`);
    }
    console.log('');
  }

  const total = errors.length + warnings.length + infos.length;
  if (errors.length > 0) {
    console.log(`FAILED: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s).`);
    process.exit(1);
  } else if (total > 0) {
    console.log(`PASSED: ${warnings.length} warning(s), ${infos.length} info(s).`);
  } else {
    console.log('PASSED: no issues found.');
  }
}

main();
