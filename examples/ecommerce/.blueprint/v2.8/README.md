# E-Shop Laptops & Electronics - Example v2.8 Blueprint

Commands beginning with `bp` below require the commercial [Archally Pro](https://archally.pro) CLI.
They are not installed by the public schema package.

A teaching model: **7 bounded contexts** across **4 domains**, with concepts,
rules, operations, architecture, motivation, decisions, quality/findings and (in `orders`) a
process, a story and test cases. For the entity, relation and file totals, which move whenever
the model does, run `bp model ecommerce` rather than trusting a number written here.

It exists to be read, not just rendered: several places where the model and the running shop
disagree are left in on purpose, because this model is about models and code disagreeing. Those are called out below rather than hidden.

## Layout

7 slice folders under this directory, one per bounded context, grouping into 4 domains (the
grouping is **not** the folder layout - see Domains below).

| Slice        | Domain             | Files                                                                               | What's here |
|--------------|---------------------|--------------------------------------------------------------------------------------|-------------|
| `catalog`    | merchandising (DMN001) | concepts, decisions, domain, models, motivation, quality                          | Product, Category; the write surface the back office calls. Holds `catalog.FN001`. |
| `shop-admin` | merchandising (DMN001) | concepts, decisions, domain, motivation, quality                                  | The back-office surface over that same range. Owns no operations of its own - it only calls Catalog's. |
| `storefront` | shopping (DMN002)      | concepts, decisions, domain, motivation, quality                                  | Everything a shopper touches. Holds no domain state of its own. |
| `checkout`   | shopping (DMN002)      | concepts, decisions, domain, models, motivation, quality                          | The cart; the one place a price is captured and held rather than displayed and forgotten. |
| `orders`     | fulfilment (DMN003)    | concepts, decisions, domain, interactions, models, motivation, quality, rules, story, test-cases | The order lifecycle (five states); the only slice with a process, a story and test cases. Holds `orders.FN001`. |
| `inventory`  | fulfilment (DMN003)    | concepts, decisions, domain, models, motivation, quality                          | Stock levels and the reservation that settles an order. |
| `customers`  | customers (DMN004)     | concepts, decisions, domain, models, motivation, quality                          | The customer account and the discounts that ride on it. Holds `customers.FN001` and `customers.FN002`. |

Root files (not inside a slice): `blueprint.yaml` (layout + domains + which migrations are
applied), `eshop.arch.yaml` (the whole architecture - see Traceability), `infrastructure.yaml`,
`organization.yaml`, `.blueprint-quality.yaml` (one quality-gate deferral, explained in the file),
and `.migrations/` (see Migrations below for replay scope).

## Domains

The problem space is 4 regions, not 7 - three of them realized by two bounded contexts each:

| Domain | Type | Realized by |
|---|---|---|
| DMN001 merchandising | core-domain | catalog, shop-admin |
| DMN002 shopping | supporting-domain | storefront, checkout |
| DMN003 fulfilment | core-domain | orders, inventory |
| DMN004 customers | generic-domain | customers |

A context names its domain with `domain_ref` in `eshop.arch.yaml`; the mapping is not inferable
from the folder tree, which is why `blueprint.yaml` writes out the reasoning (process PRC001 spans
orders+inventory; ShopAdmin calls Catalog and answers no question of its own; Checkout and
Inventory have zero relations between them, etc.).

## Traceability

- **orders**: Concept CN001 → transition_rules [TR002-TR007], the six legal moves of a five-state
  lifecycle; rule SR001 → concepts [CN001]; CMD004 governed_by all six and is the only operation
  that moves an order through them; tests TC004 and ER004 validate a legal move and a refused one;
  decision DC002 records the reconciliation and finding FN001 records what it exposed.
- **arch**: the architecture lives in **`eshop.arch.yaml` at the model root**, not inside any one
  slice - one file describing all 7 contexts (BC001-BC007: Catalog, Orders, Inventory, Checkout,
  Storefront, ShopAdmin, Customers), their services and their contracts. `bp check` flags all 7 as
  "context-unplaced" (advisory only): their declarations live at the root rather than inside the
  slice folder they resemble.

## Code references

The shop's code is in **another repository** - `repository:` in `blueprint.yaml` names it - and
every `code_ref` in this model is a path relative to that repository's root. Refs are written
**bare**, never in the cross-repo `org/repo#path` form: Archally Pro's `bp coverage-check` resolves a
ref against its `--code-root`, and reports a prefixed ref as `unverifiable` and leaves it out of the
count. Bare is the form the audit can check.

Check them with the repository that holds the code:

```
bp coverage-check --audit --project ecommerce --code-root <the shop repository>
bp coverage-check services/orders-service/src/server.ts --project ecommerce --code-root <the shop repository>
```

### Which entities carry a ref, and which carry a finding instead

A ref names one file that **contains the thing**. A ref to a directory is not accepted, and neither
is a ref that makes a number look better than the model is - a file that does not hold the entity
passes every check and teaches the reader something false, which is worse than no ref at all.

| Entity kind | Gets a ref | The ref names |
|---|---|---|
| Operation | it has a route in a running service | the file holding the route handler |
| Model schema (MDL) | its fields are a declared type in the code | that type's own file |
| Concept | one file declares the type, or one file is where it is composed | that file |
| Arch service | the process exists | its **entry file** (`src/server.ts`, `Program.cs`, `src/main.ts[x]`), never its directory |
| Rule | it is enforced at one identifiable place | the file holding the check |

Where an entity plainly has an implementation and no honest single anchor exists, it gets a
**finding** in the slice that owns it, not a ref. Six are written this way and are listed in the
next section. Two slices are exempt by design:

- **`delivery/`** carries no ref at all, deliberately. Every entity in it is `hypothesis` /
  `speculative` and the absence of a ref is what says the context is a design rather than a
  description. `delivery/README.md` is the authority; adding refs there would make the model lie.
- **`checkout/`** carries no ref because the word `cart` appears nowhere in the shop.
  `checkout.RSK001` holds that, with its evidence, and it is a risk rather than a finding because
  what is missing is the whole context and not a disagreement inside one.

A ref also de-orphans: a model schema that a `code_ref` names is no longer reported by `bp check` as
an orphan, because a `code_ref` is an edge in the graph like any other. That is a side effect worth
knowing about and not a reason to add one.

## Migrations

`.migrations/` contains nine authored examples. The `migrations:` list in `blueprint.yaml`
marks MIG005 (Inventory subscribes to Order Submitted) as applied; all others are pending
or draft and do not describe the AS-IS files.

| Migration | Purpose | Supported replay scope |
|---|---|---|
| MIG001 (Add payment retry) | Introduces retry operations | Its point-in-time dependency closure |
| MIG002 (Split order into header and lines) | Splits the order aggregate | Its point-in-time dependency closure |
| MIG003 (Tag payment operations) | Labels extraction candidates | Its point-in-time dependency closure |
| MIG004 (Add loyalty program) | Deliberately invalid negative example | Failure demonstration only |
| MIG005 (Inventory subscribes to Order Submitted) | Records the applied integration | Already carried by AS-IS files |
| MIG006 (Orders and Inventory published language) | Corrects the two conformist dependencies | Its point-in-time dependency closure |
| MIG007 (Storefront closes accounts) | Addresses customers.FN002 (Account closure remains in the back office) | Its point-in-time dependency closure |
| MIG009 (Introduce Shipments) | Adds the shipping context | Its point-in-time dependency closure |
| MIG008 (Orders publishes Order Confirmed) | Moves shipping onto orders.EVT002 (Order Confirmed) | Its point-in-time dependency closure, including MIG009 (Introduce Shipments) |

MIG005 (Inventory subscribes to Order Submitted) is already applied, so it is not replayed.
Migration ids are identifiers, not an order in time.

**Full TO-BE is a failure demonstration, not a valid future shop.** It stops at
MIG004 (Add loyalty program) with five errors: duplicate orders.CN001 (Order), a mismatching
before-state for that concept, a property target `orders.MISSING_EVENT` that does not exist,
a mismatching old description for orders.CMD001 (Submit Order), and removal of a nonexistent
edge to `catalog.CN999`. MIG004 (Add loyalty program) and MIG008 (Orders publishes Order Confirmed)
remain unreplayed in that full selection. A zero exit from `bp validate ecommerce` reports this
intentionally invalid migration as a warning; it does not establish successful full replay.

For a valid shipping demonstration select the **point in time of MIG008 (Orders publishes Order
Confirmed)**. Its dependency closure excludes the unrelated negative example and replays
MIG009 (Introduce Shipments) first. For example:

```bash
bp nfr ecommerce --mode point-in-time --migration MIG008
```

Use the same selection in a viewer or renderer that offers model-state selection; an unfiltered
TO-BE snapshot is not a valid shipping state. MIG004 (Add loyalty program) stays in the example to
show how a replay reports an invalid migration.

## Deliberate model/code divergence

Fifteen findings (`bp model ecommerce` → Finding: 15) hold places where this model and the shop it
describes disagree on purpose, so a reader can see what a real divergence looks like rather than
have it silently reconciled away. The first five were written from the code before this model
pointed at it; the next six came out of the pass that added the `code_refs` above, which is the
argument for adding them - a ref makes a disagreement visible, and six were found by looking for an
honest file to name and not finding one. The last four came out of comparing each model schema with
the class it names, which is the same argument one step further on: a ref makes a disagreement
visible, and a check over the ref makes it countable. The count is read off `bp model` rather than
maintained by hand.

- **catalog.FN001** - Update Product Price is modelled as writing the catalog's price; the running
  endpoint only quotes one, and writes nothing back.
- **orders.FN001** - a draft-then-submit stage survives in three operations and a lifecycle that,
  after DC002 reconciled its two status vocabularies to one, no longer contains that stage.
- **customers.FN001** - three different situations (nothing earned, account inactive, read failed)
  reach the pricing step as the same empty discount set, indistinguishable to the caller.
- **shop-admin.FN001** - the back office offers a price *quote* with no control that writes one, and
  catalog.CMD002, the operation that would, is reachable from no screen.
- **customers.FN002** - closing an account is decided (`customers.DC003`) as an administrator's act
  on the storefront; the storefront has no such call and the back office still has the delete the
  decision was meant to retire. MIG007 (above) is the pending fix.
- **orders.FN002** - the create route binds a request shape this model does not declare, while the
  payload the model *does* declare for that command describes a different operation's body.
- **orders.FN003** / **catalog.FN002** - both list reads are declared as paged envelopes and served
  as bare arrays. Two entries because each names the schema its own slice owns; one decision.
- **orders.FN004** - three events, four AsyncAPI contracts and a RabbitMQ cluster, and no messaging
  of any kind in the shop. The integration the shop has is a synchronous HTTP call this model does
  not describe.
- **inventory.FN001** - the infrastructure layer's local hosts are shifted by one service, and the
  account service has no resource at all.
- **storefront.FN001** - the product page is defined as composing the catalog and Inventory; it
  composes the catalog and Orders, and takes availability off the catalog product.
- **orders.FN005** / **catalog.FN003** - the two read-models and the interfaces the services
  actually return are different shapes: `orderId` against `id`, `lines` against `items`, `sku`
  against `productId`, a `currency` neither service carries, and an `inStock` boolean where the
  shop answers a count.
- **inventory.FN002** / **customers.FN003** - five classes state almost no requiredness where this
  model states a good deal. Two entries because each names the schemas its own slice owns; one
  question.

### How to record a deliberate divergence

Write a **finding** in the `quality.yaml` of the slice that owns the disagreeing entity. That is the
whole mechanism; there is no second one, and a YAML comment, a `certainty` downgrade or a new field
would each be a different answer to a question this model has already answered.

The model-code agreement check this example is maintained with, which is not part of the public tools,
compares every model schema that names a class against that class and passes only when each
difference is **absent or recorded**, so a finding is also what makes the check
green. It matches a finding to a difference on two conditions, and both must hold:

1. **The finding identifies the pair**, by carrying a `code_ref` to the same file the schema's
   `code_refs` names, or by writing the schema's `x-model-id` (`MDL034`) into its own text. Both are
   identifiers, so both are exact. The schema's *name* is deliberately not accepted: `Order`,
   `Product` and `Customer` are ordinary English words, and matching them against prose made one
   entry about `ProductList` appear to record eight differences belonging to three other schemas.
2. **The finding names the field**, spelled as one of the two sides spells it, case-sensitively.
   Naming the schema alone is not enough - it would silence every disagreement on that schema,
   including ones nobody has looked at yet.

A finding is `status: open` and stays open. Recording a divergence is not resolving it: it states
that two artefacts disagree, says which reading each takes, and leaves the decision to whoever can
make it.

## Gray nodes

The model carries 12 entities of type `Missing` (`bp model ecommerce`), which the Archally Pro
viewer draws as gray nodes, although each names something this model declares. Five are `model_ref`
names in PascalCase form (`Order`, `SubmitOrderRequest`, `SetOrderStatusRequest`, `OrderList`,
`OrderLine`), a form the schema allows, each matching a `components.schemas` key in
`orders/models.yaml`. Seven are `domain_scope` and `linked_contexts` values: the schema defines them
as scope prefixes that resolve to no entity. The public validator and `bp validate` accept both, and
no rendered artifact draws them as gaps.

## Validate it

From a Blueprint Schema checkout:

```bash
npm run validate:ecommerce:v28
npm run check:ecommerce:v28
```

With Archally Pro:

```bash
bp validate ecommerce   # schema + cross-reference - is it legal?
bp check ecommerce      # semantic rules - is it connected?
```
