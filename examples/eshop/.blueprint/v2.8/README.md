# eShop order flow (workshop slice)

A blueprint model of one journey through [dotnet/eShop](https://github.com/dotnet/eShop), the .NET
reference application: an order is placed, waits out a grace period, has its stock confirmed by
Catalog, is paid through the payment processor and is shipped or cancelled. Identity, webhooks, the
storefront UI, catalog administration and semantic search are outside this slice.

The model describes the application's architecture. It copies no source code; where an entity names
the code that implements it, it points at a path in the repository that `blueprint.yaml` names, with a `code_refs` entry.

## Layout

| Path | What it holds |
|---|---|
| `blueprint.yaml` | the model's name, its repository, the four slices and the four domains they realise |
| `eshop.arch.yaml` | the system, the four bounded contexts with their services, dependencies and contracts, and the event bus channels |
| `infrastructure.yaml` | the message broker the services publish and subscribe through |
| `ordering/` | the order lifecycle: concepts, operations, the buyer's story |
| `catalog/`, `payment/`, `basket/` | the operations each of those contexts contributes to the order flow |

Validate it with the Archally Blueprint validator or, with Archally Pro, `bp validate`.

## Attribution

dotnet/eShop is licensed under the MIT licence, (c) .NET Foundation and Contributors. This model and
the repository that carries it are not affiliated with or endorsed by Microsoft or the .NET
Foundation.
