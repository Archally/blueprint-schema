# Ecommerce and eShop examples

The public repository carries two independent ecommerce versions and a compact eShop model.
Run these commands from the root of a Blueprint Schema checkout with dependencies installed.

| Example | Model directory | Validation command |
|---|---|---|
| Legacy ecommerce v2.6 | `examples/ecommerce/.blueprint/v2.6` | `node tools/validator/src/cli.mjs examples/ecommerce/.blueprint/v2.6 --schemas schema/v2.6` |
| Ecommerce v2.8 | `examples/ecommerce/.blueprint/v2.8` | `node tools/validator/src/cli.mjs examples/ecommerce/.blueprint/v2.8 --schemas schema/v2.8` |
| eShop v2.8 | `examples/eshop/.blueprint/v2.8` | `node tools/validator/src/cli.mjs examples/eshop/.blueprint/v2.8 --schemas schema/v2.8` |

The legacy v2.6 teaching model has its own history, generated views and commands.
Its `validate:examples`, `check:examples` and `render:ecommerce` entry points retain their existing
v2.6 behavior. The v2.8 directories are separate models with their own validation commands.

Ecommerce v2.8 contains the complete model and nine migration files. MIG004 (Add loyalty program)
is an intentional invalid migration that demonstrates a replay reporting an error. A full TO-BE
replay stops there; the migration sequence is not advertised as a successful end-to-end replay.
Model conformance validation and migration replay answer different questions. eShop is the smaller
example with catalog, basket, ordering and payment contexts. Each model's own README describes it.

Generated `.specs/` views and editor settings are not part of the published models.
