import path from 'node:path';
import process from 'node:process';
import { applyChain, detectVersion, listUpdates, resolveChain } from './runner.js';

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

  const chain = resolveChain(version);
  if (chain.length === 0) {
    console.error(`No update available for v${version}.`);
    const available = listUpdates();
    if (available.length > 0) {
      console.error(`Available updates: ${available.map((u) => `v${u.sourceVersion}→v${u.targetVersion}`).join(', ')}`);
    }
    process.exit(1);
  }

  const route = [version, ...chain.map((u) => u.targetVersion)].map((v) => `v${v}`).join(' → ');
  console.log(`Schema update: ${route}${chain.length > 1 ? `  (${chain.length} hops)` : ''}`);
  console.log(`Directory:     ${resolvedDir}`);
  console.log(`Mode:          ${dryRun ? 'dry-run (no changes)' : 'apply'}`);
  console.log('');

  if (dryRun) {
    // Only the FIRST hop can be planned truthfully. A later hop runs against the tree the
    // earlier one produces — `001` even renames the version directory — so planning it against
    // the current tree would print changes for files that will not be in that state. Later hops
    // are announced, not fabricated.
    const [first, ...rest] = chain;
    const plan = first!.plan(resolvedDir);

    console.log(`Hop 1 — v${first!.sourceVersion} → v${first!.targetVersion}: ${first!.description}`);
    if (plan.warnings.length > 0) {
      console.log('  Warnings:');
      for (const warning of plan.warnings) console.log(`    ⚠ ${warning}`);
    }
    if (plan.changes.length === 0) {
      console.log('  No changes needed.');
    } else {
      console.log(`  Planned changes (${plan.changes.length}):`);
      for (const change of plan.changes) console.log(`  ${formatChange(change)}`);
    }

    rest.forEach((update, index) => {
      console.log('');
      console.log(`Hop ${index + 2} — v${update.sourceVersion} → v${update.targetVersion}: ${update.description}`);
      console.log('  Planned once the previous hop has applied (it transforms that hop\'s output).');
    });

    console.log('');
    console.log('Run without --dry-run to apply the whole chain.');
  } else {
    const outcome = applyChain(resolvedDir);

    outcome.hops.forEach((hop, index) => {
      const { update, result } = hop;
      console.log(`Hop ${index + 1} — v${update.sourceVersion} → v${update.targetVersion}: ${update.description}`);
      for (const warning of result.warnings) console.log(`    ⚠ ${warning}`);
      if (result.changes.length === 0) {
        console.log('  No changes needed.');
      } else {
        console.log(`  Applied changes (${result.changes.length}):`);
        for (const change of result.changes) console.log(`  ${formatChange(change)}`);
      }
      for (const error of result.errors) console.log(`    ✗ ${error}`);
      console.log('');
    });

    if (outcome.error) {
      console.error(outcome.error);
      if (outcome.hops.length > 1) {
        console.error('Earlier hops DID apply — re-run against the current directory to resume.');
      }
      process.exit(1);
    }

    console.log(`Update complete (${outcome.hops.length} hop${outcome.hops.length === 1 ? '' : 's'}).`);
    if (outcome.finalDirectory !== resolvedDir) {
      console.log(`Model is now at: ${outcome.finalDirectory}`);
    }
    console.log('Run blueprint-schema-validate to verify the result.');
  }
}

main();
