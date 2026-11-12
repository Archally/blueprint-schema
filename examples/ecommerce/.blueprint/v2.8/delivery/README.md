# delivery

One bounded context, `Shipments` (BC008), realizing the `delivery` domain (DMN005).

**Nothing in this folder is implemented.** There is no shipping code in this shop,
and this slice exists to show that a model can describe a region of the business
before the code does, without pretending otherwise.

How that is stated, in the model rather than in prose:

- every concept, actor and operation carries `provenance` with
  `discovery_stage: hypothesis` and `certainty: speculative`, and no `evidence`,
  because there is none to cite. Elsewhere in this model provenance reads
  `validated` / `confirmed` over a `codebase-analysis` record;
- nothing here carries `code_refs`. The schema puts the two fields side by side
  on purpose: `code_refs` say where an entity is implemented, `provenance` says
  how sure the modelling judgement is. Absent code_refs plus speculative
  provenance is the honest pair;
- `SVC009` in `eshop.arch.yaml` carries the same provenance block, so the service
  reads as a proposed one rather than an observed one, and it is deliberately
  absent from `infrastructure.yaml` - there is nothing deployed to place in a
  tier.

The interesting thing this slice found, which is the reason it is worth showing:
**Orders publishes nothing a shipping context can subscribe to.** Its only event
is Order Submitted, which fires before confirmation, and Set Order Status - the
one operation that ever moves an order through its lifecycle - produces no event
and says so in its own description. So `Prepare Shipment` subscribes to
Inventory's Stock Reserved instead, which says stock is held rather than that the
order survived. `delivery.QN002` holds that gap, `delivery.ASM001` holds what the
design is assuming while it stays open, and both are blocking in the sense that
matters: they decide whether this context can be built as drawn.
