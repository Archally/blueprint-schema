#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { parse as parseYaml } from 'yaml';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
import type { CheckerConfig, SemanticIssue } from '@archally/semantic-checker';
import { loadFromDirectory, buildBlueprintModel } from '@archally/blueprint-schema/model';
import { toCheckableModel } from './adapter.js';

const RULES_DIR = fileURLToPath(new URL('../rules', import.meta.url));

function loadConfig(configPath: string | undefined): CheckerConfig {
  const candidates = configPath ? [configPath] : ['.blueprint-lint.yaml', '.blueprint-lint.yml'];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return (parseYaml(fs.readFileSync(resolved, 'utf8')) as CheckerConfig) ?? {};
    if (configPath) { console.error(chalk.red(`Config file not found: ${resolved}`)); process.exit(2); }
  }
  return {};
}

type Colorize = (text: string) => string;

function printGroup(label: string, issues: SemanticIssue[], color: Colorize): void {
  if (issues.length === 0) return;
  console.log(chalk.bold(color(`${label}:`)));
  for (const issue of issues) console.log(`  ${chalk.dim(`[${issue.ruleId}]`)} ${color(issue.message)}`);
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let blueprintDir: string | undefined;
  let configPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--help' || token === '-h') {
      console.log('Usage: blueprint-check <blueprint-dir> [--config <path>] [--list]');
      return;
    }
    if (token === '--list') {
      const rules = await loadRules(RULES_DIR);
      console.log(chalk.bold('Available rules:\n'));
      for (const rule of rules) console.log(`  ${chalk.cyan(rule.id)} ${chalk.dim(`(default: ${rule.severity})`)}\n    ${rule.description}\n`);
      return;
    }
    if ((token === '--config' || token === '-c') && args[i + 1]) { configPath = args[++i]; continue; }
    if (!token.startsWith('-')) blueprintDir = path.resolve(token);
  }

  const resolvedDir = blueprintDir ?? path.resolve('.blueprint/v2.7');
  const config = loadConfig(configPath);
  const rules = await loadRules(RULES_DIR);

  console.log(`${chalk.cyan('Model:')}  ${resolvedDir}`);
  console.log(`${chalk.cyan('Config:')} ${configPath ?? chalk.dim('(defaults)')}`);
  console.log(`${chalk.cyan('Rules:')}  ${rules.length} loaded`);
  console.log('');

  // buildBlueprintModel may print model-builder warnings here (e.g. placeholder operations);
  // preserve the legacy ordering: header → build → Entities/Relations → checker → issues.
  const { documentsByType } = loadFromDirectory(resolvedDir);
  const model = toCheckableModel(buildBlueprintModel(documentsByType));

  console.log(`${chalk.cyan('Entities:')}  ${model.entities.length}`);
  console.log(`${chalk.cyan('Relations:')} ${model.relations.length}`);
  console.log('');

  const issues = runChecker(model, rules, config, await loadExtensions(rules));

  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warn');
  const infos = issues.filter(issue => issue.severity === 'info');
  printGroup('Errors', errors, chalk.red);
  printGroup('Warnings', warnings, chalk.yellow);
  printGroup('Info', infos, chalk.blue);

  if (errors.length > 0) {
    console.log(chalk.red.bold(`FAILED: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s).`));
    process.exit(1);
  } else if (errors.length + warnings.length + infos.length > 0) {
    console.log(chalk.green.bold(`PASSED: ${warnings.length} warning(s), ${infos.length} info(s).`));
  } else {
    console.log(chalk.green.bold('PASSED: no issues found.'));
  }
}

main();
