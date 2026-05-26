# Blueprint Semantic Checker

Configurable rule engine for semantic analysis of blueprint models. Catches modeling issues that schema validation alone cannot detect — orphan entities, missing causal links, untested rules, domain gaps.

## Usage

```bash
# From repo root
npx @archally/blueprint-schema blueprint-check .blueprint/v2.7

# Via npm script
npm run check:examples
```

## Built-in Rules

| Rule ID | Default | What it checks |
|---------|---------|---------------|
| `orphan-entities` | warn | Entities defined but never referenced by any relation |
| `missing-causal-links` | warn | Commands without `produces` link to any event |
| `events-with-produces` | warn | Events with `produces` (anti-pattern — use `reacts_to` on the consuming command) |
| `untested-rules` | warn | Business rules without a corresponding test case |
| `aggregate-root-signals` | info | Aggregate roots without states, relationships, or governance links |
| `unanswered-questions` | info | Domain questions with no operation answering them (domain gaps) |

List all rules: `npx @archally/blueprint-schema blueprint-check --list`

## Configuration

Create a `.blueprint-lint.yaml` in your project root to customize rule severity:

```yaml
rules:
  orphan-entities: warn
  missing-causal-links: error
  aggregate-root-signals: off
  untested-rules: warn
  events-with-produces: error
  unanswered-questions: info
```

Severity values: `error` (fails the check), `warn` (reports but passes), `info` (informational), `off` (disabled).

Pass a custom config path: `blueprint-check .blueprint/v2.7 --config my-config.yaml`

## Writing Custom Rules

The checker is extensible. A rule is a function that takes a `BlueprintModel` and returns issues:

```typescript
import type { RuleDefinition } from '@archally/blueprint-schema/semantic-checker';

const myRule: RuleDefinition = {
  id: 'my-custom-rule',
  name: 'My Custom Rule',
  description: 'Checks something specific to my project.',
  defaultSeverity: 'warn',
  check(model) {
    const issues = [];
    for (const entity of model.entities) {
      // your logic here
    }
    return issues;
  },
};
```

Register custom rules by importing the engine directly:

```typescript
import { runChecker, builtinRules } from '@archally/blueprint-schema/semantic-checker';
import { loadFromDirectory } from '@archally/blueprint-schema/model';
import { buildBlueprintModel } from '@archally/blueprint-schema/model';

const { documentsByType } = loadFromDirectory('.blueprint/v2.7');
const model = buildBlueprintModel(documentsByType);

const allRules = [...builtinRules, myRule];
const issues = runChecker(model, allRules, config);
```

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `<path>` | Blueprint directory (positional) | `.blueprint/v2.7` |
| `--config`, `-c` | Path to `.blueprint-lint.yaml` | Auto-detect in current directory |
| `--list` | List available rules and exit | — |
| `--help`, `-h` | Show help | — |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Passed (may have warnings and info) |
| 1 | Failed (at least one error-severity issue) |
| 2 | Runner error (missing directory, invalid config) |

## Architecture

```
src/
  types.ts        — RuleDefinition, SemanticIssue, CheckerConfig interfaces
  engine.ts       — runChecker() — loads rules, applies config, collects issues
  cli.ts          — CLI entry point — loads model, runs checker, reports results
  rules/
    index.ts                  — Built-in rule registry
    orphan-entities.ts        — Unreferenced entities
    missing-causal-links.ts   — Commands without produces
    events-with-produces.ts   — Events misusing produces
    untested-rules.ts         — Rules without test coverage
    aggregate-root-signals.ts — Aggregate roots missing signals
    unanswered-questions.ts   — Domain knowledge gaps
```

The checker depends on the model-builder — it operates on a `BlueprintModel` (entities + relations graph), not raw YAML files.
