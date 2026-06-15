# Example — PrestaShop (large, multi-context model)

A blueprint of the open-source **[PrestaShop](https://github.com/PrestaShop/PrestaShop) v9** e-commerce platform — modeled from the real codebase. This is the counterpoint to the [ecommerce MVB](../ecommerce/): what a mature, Phase 3+ model looks like at scale. Schema **v2.7**, 10 bounded contexts, 158 YAML files, ~1,900 entities.

```
.blueprint/v2.7/
  admin/  catalog/  checkout/  content/  customers/
  international/  modules/  orders/  shipping/  shop/
```

## Validate it

From the repo root:

```bash
node tools/validator/src/cli.mjs examples/prestashop/.blueprint/v2.7 --schemas schema/v2.7
node tools/semantic-checker/dist/cli.js examples/prestashop/.blueprint/v2.7   # after `npm run build`
```

## How to explore it

At ~1,900 entities you don't read this top-to-bottom. Two good entry points:

- **The generated overview** — [`.blueprint/v2.7/.specs/overview.md`](./.blueprint/v2.7/.specs/overview.md): markdown + Mermaid diagrams of contexts and causal chains, produced by the `blueprint-render` tool. Start here.
- **One context at a time** — open a single directory (e.g. `orders/` or `catalog/`) and read its `concepts.yaml` → `domain.yaml` → `rules.yaml`. Each context is independently legible.

## What it demonstrates

- **Brownfield modeling** — derived from an existing codebase: aggregates enumerated from the source, operations grouped into business-meaningful commands/queries, entities linked back to code via `code_refs`. The code is the source of truth for the design plane.
- **Slices that scale** — many small `{name}.{layer}.yaml` files per context keep a 1,900-entity model navigable.
- **Cross-context structure** — bounded contexts as architectural boundaries (in `arch`), distinct from the directory slices that organize the files.
- **Generated artifacts stay in sync** — the `.specs/overview.md` is derived from the model, not hand-maintained.

See also: [Modeling Guide](../../docs/modeling-guide.md) (Phase 0 — brownfield analysis) · [Schema Reference](../../docs/schema-reference.md) · the smaller [ecommerce example](../ecommerce/) for the minimal starting point.
