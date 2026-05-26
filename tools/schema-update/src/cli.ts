import path from 'node:path';
import process from 'node:process';
import { detectVersion, findUpdate, listUpdates } from './runner.js';

function printUsage() {
  const lines = [
    'Usage: blueprint-schema-update <blueprint-dir> [options]',
    '',
    'Update a blueprint model to the next schema version.',
    '',
    'Arguments:',
    '  <blueprint-dir>    Path to .blueprint/v{N} directory',
    '',
    'Options:',
    '  --dry-run          Show planned changes without applying',
    '  --list             List all available schema updates',
    '  --help, -h         Show this help message',
    '',
    'Examples:',
    '  blueprint-schema-update .blueprint/v2.6 --dry-run',
    '  blueprint-schema-update .blueprint/v2.6',
    '  blueprint-schema-update --list',
  ];
  console.log(lines.join('\n'));
}

function formatChange(change: { type: string; detail: string }) {
  const icon =
    change.type === 'rename-file' ? '  [rename]' :
    change.type === 'rename-directory' ? '  [dir]   ' :
    change.type === 'edit-yaml' ? '  [edit]  ' :
    change.type === 'remove-file' ? '  [remove]' :
    '  [?]     ';
  return `${icon} ${change.detail}`;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  if (args.includes('--list')) {
    const updates = listUpdates();
    console.log(`Available schema updates (${updates.length}):\n`);
    for (const update of updates) {
      console.log(`  v${update.sourceVersion} → v${update.targetVersion}: ${update.description}`);
    }
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const blueprintDir = args.find((a) => !a.startsWith('--'));

  if (!blueprintDir) {
    console.error('Error: blueprint directory argument required');
    printUsage();
    process.exit(1);
  }

  const resolvedDir = path.resolve(blueprintDir);
  const version = detectVersion(resolvedDir);

  if (!version) {
    console.error(`Error: cannot detect schema version from ${resolvedDir}`);
    console.error('Expected directory name like v2.6 or blueprint.yaml with a version field.');
    process.exit(1);
  }

  const update = findUpdate(version);
  if (!update) {
    console.error(`No update available for v${version}.`);
    const available = listUpdates();
    if (available.length > 0) {
      console.error(`Available updates: ${available.map((u) => `v${u.sourceVersion}→v${u.targetVersion}`).join(', ')}`);
    }
    process.exit(1);
  }

  console.log(`Schema update: v${update.sourceVersion} → v${update.targetVersion}`);
  console.log(`Description:   ${update.description}`);
  console.log(`Directory:     ${resolvedDir}`);
  console.log(`Mode:          ${dryRun ? 'dry-run (no changes)' : 'apply'}`);
  console.log('');

  if (dryRun) {
    const plan = update.plan(resolvedDir);

    if (plan.warnings.length > 0) {
      console.log('Warnings:');
      for (const warning of plan.warnings) {
        console.log(`  ⚠ ${warning}`);
      }
      console.log('');
    }

    if (plan.changes.length === 0) {
      console.log('No changes needed.');
    } else {
      console.log(`Planned changes (${plan.changes.length}):`);
      for (const change of plan.changes) {
        console.log(formatChange(change));
      }
    }
    console.log('');
    console.log('Run without --dry-run to apply.');
  } else {
    const result = update.apply(resolvedDir);

    if (result.warnings.length > 0) {
      console.log('Warnings:');
      for (const warning of result.warnings) {
        console.log(`  ⚠ ${warning}`);
      }
      console.log('');
    }

    if (result.changes.length === 0) {
      console.log('No changes needed.');
      process.exit(0);
    }

    console.log(`Applied changes (${result.changes.length}):`);
    for (const change of result.changes) {
      console.log(formatChange(change));
    }

    if (result.errors.length > 0) {
      console.log('');
      console.log('Errors:');
      for (const error of result.errors) {
        console.log(`  ✗ ${error}`);
      }
      process.exit(1);
    }

    console.log('');
    console.log('Update complete. Run blueprint-schema-validate to verify the result.');
  }
}

main();
