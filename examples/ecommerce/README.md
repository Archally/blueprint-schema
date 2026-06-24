# Example — E-commerce (Minimal Viable Blueprint)

A small, **synthetic** blueprint that shows the shape of a Phase 1 model: just enough to be coherent and validate cleanly. Schema **v2.6**, 3 bounded contexts, 11 YAML files, ~23 entities.

```
.blueprint/v2.6/
  blueprint.yaml          root — lists the contexts
  catalog/                concepts · domain · rules · test-cases
  orders/                 concepts · domain · rules · story · test-cases
  payments/               domain
```

## Validate it

From the repo root:

```bash
npm run validate:examples   # schema + cross-reference integrity (against schema/v2.6)
npm run check:examples      # semantic checker (orphans, missing causal links, …)
```

Both pass cleanly. `validate:examples` reports a few **gap warnings** (e.g. no protocol bindings) — expected for an MVB, not errors.

## Read it in this order

1. **`blueprint.yaml`** — the root: which contexts exist.
2. **`catalog/concepts.yaml`** — ubiquitous language first (the `Product` aggregate, value objects).
3. **`catalog/domain.yaml`** — operations: the command → event causal chains.
4. **`catalog/rules.yaml`** — invariants governing those operations.
5. **`orders/`** — the same pattern, plus **`story.yaml`** (a user-facing flow) and richer test cases.
6. **`payments/domain.yaml`** — a deliberately thin context: one aggregate, a couple of operations. Not everything has to be modeled to the same depth.

## What it demonstrates

- **MVB-first**: aggregate roots + key commands/events + one story + happy-path tests — then stop. A focused 23-entity model that validates beats a 200-entity hairball.
- **Multiple small files per slice** instead of one monolith per context.
- **Business names in the model**; implementation details belong in `code_refs`.

A generated overview (markdown + Mermaid) lives at [`.blueprint/v2.6/.specs/overview.md`](./.blueprint/v2.6/.specs/overview.md) — produced by the `blueprint-render` tool.

See also: [Modeling Guide](../../docs/modeling-guide.md) · [Schema Reference](../../docs/schema-reference.md) · the larger [PrestaShop example](../prestashop/) for what a mature model looks like at scale.
