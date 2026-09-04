# entity-query — search before you mint

Answers *"does the model already describe this?"* deterministically, instead of grepping the YAML.

A duplicate entity is the drift class no validator catches: it is legal YAML, it passes schema
validation and semantic checks, and it only becomes visible months later as two half-modelled
versions of the same idea. Searching first is the whole fix, and it only happens if searching is
one command.

```bash
# once — build the model the query runs against
npm run build && node tools/model-builder/dist/cli.js .blueprint/v2.8 --output model.json

# then, as often as you like
node tools/entity-query/cli.mjs model.json --text "order"
node tools/entity-query/cli.mjs model.json --text "cart" --types Concept,Operation
node tools/entity-query/cli.mjs model.json --tag core --layer domain --limit 100
```

| Flag | Effect |
|---|---|
| `--text <q>` | Case-insensitive substring across id, name, tags, summary and description |
| `--types a,b` | Exact entity types (case-insensitive); any match passes |
| `--layer <l>` | Substring against the entity's layer; comma-separated for several |
| `--tag <t>` | Exact tag (case-insensitive); comma-separated for several |
| `--limit <n>` | Rows to show (default 50). The **total** is always printed, so truncation is visible |
| `--require-match` | Exit 1 when nothing matched — for scripting a "must already exist" assertion |
| `--json` | Machine-readable result |

Filters combine conjunctively: `--text order --types Operation` means both.

## Why it reads `model.json` and not the YAML

The other zero-build tools (`validator`, `quality-gate`, `next-id`, `coverage-check`) read the YAML
directly, because each needs one raw field. Search needs *entities* — typed, named, layered,
de-duplicated across files — and turning documents into entities is exactly what `model-builder`
does. A second extractor here would be a third implementation of that job, free to drift from both
and guaranteed to disagree about edge cases nobody tests.

So the one-time cost is a build; the query itself is a plain `.mjs` over a JSON file.

## Ranking is coarse on purpose

Results are ordered by **where** the text hit, not by a relevance score:

| `matched` | Meaning |
|---|---|
| `exact` | The id **or** the name *is* the query — the strongest "yes, this already exists" |
| `id` | The typed id or display id contains the query |
| `name` | The entity's name contains it |
| `tag` | A tag contains it |
| `body` | Only the summary or description contains it |

The question being asked is "does this exist already?", which needs the exact-id hit at the top —
not a plausible-looking paragraph. A score nobody can predict is worse than a rank everybody can.
The `matched` column is printed for every row, so you can see why something surfaced.

## Relationship to `bp query`

`bp` is the **Archally Pro** CLI ([archally.pro](https://archally.pro)) — a separate commercial
product, not part of this package. It exposes the same search as a verb.

The filtering and ranking are the same code: `search.mjs` is **generated** from the very module
the Pro CLI imports, so the two cannot rank results differently. Do not edit `search.mjs`.
