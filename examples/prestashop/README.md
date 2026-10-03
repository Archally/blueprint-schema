# Example — PrestaShop (large, multi-context model)

A blueprint of the open-source **[PrestaShop](https://github.com/PrestaShop/PrestaShop) v9** e-commerce platform, modeled from the real codebase. This is the counterpoint to the [ecommerce MVB](../ecommerce/): what a mature, Phase 3+ model looks like at scale. Schema **v2.8**, a dozen bounded contexts, well over a hundred YAML files and several thousand entities.

```
.blueprint/v2.8/
  admin/  catalog/  checkout/  content/  customers/
  international/  modules/  orders/  shipping/  shop/
```

## Validate it

From the repo root:

```bash
node tools/validator/src/cli.mjs examples/prestashop/.blueprint/v2.8 --schemas schema/v2.8
node tools/semantic-checker/dist/cli.js examples/prestashop/.blueprint/v2.8   # after `npm run build`
```

## How to explore it

At several thousand entities you don't read this top-to-bottom. Two good entry points:

- **The generated overview** — [`.blueprint/v2.8/.specs/overview.md`](./.blueprint/v2.8/.specs/overview.md): markdown + Mermaid diagrams of contexts and causal chains, produced by the `blueprint-render` tool. Start here.
- **One context at a time** — open a single directory (e.g. `orders/` or `catalog/`) and read its `concepts.yaml` → `domain.yaml` → `rules.yaml`. Each context is independently legible.

## What it demonstrates

- **Brownfield modeling** — derived from an existing codebase: aggregates enumerated from the source, operations grouped into business-meaningful commands/queries, entities linked back to code via `code_refs`. The code is the source of truth for the design plane.
- **Slices that scale** - many small `{name}.{layer}.yaml` files per context keep a model of several thousand entities navigable.
- **Cross-context structure** — bounded contexts as architectural boundaries (in `arch`), distinct from the directory slices that organize the files.
- **Generated artifacts stay in sync** — the `.specs/overview.md` is derived from the model, not hand-maintained.

See also: [Modeling Guide](../../docs/modeling-guide.md) (Phase 0 — brownfield analysis) · [Schema Reference](../../docs/schema-reference.md) · the smaller [ecommerce example](../ecommerce/) for the minimal starting point.
