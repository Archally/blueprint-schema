# contract-surface

Who exposes an operation, who calls it, who sends an event, who receives it - and therefore which
services actually talk to each other, over what protocol, and how many operations flow between them.

A dependency arrow that says only "A depends on B" answers almost nothing. *How* (HTTP, message,
RPC), *which way*, and *how much* are all derivable from the contract refs a model already
authors, and this module is where that derivation lives, once, for every consumer.

## What it exports

| | |
|---|---|
| `normaliseService(service)` | one service from either input shape into the common one |
| `buildContractSurface(services)` | the operation index: ref to the services that expose, call, send or receive it |
| `deriveServiceEdges(surface)` | service-to-service edges with protocol, direction, operations and broker |
| `deriveSurfaceGaps(surface, declared)` | refs nobody exposes, exposures nobody calls, and declared pairs with no traffic |
| `aggregateEdges(edges, groupOf)` | the same edges lifted to any grouping, such as service to context |
| `PROTOCOL_ORDER`, `PROTOCOL_LABEL` | the protocol vocabulary and its display strings |

## Two rules worth knowing before you read a result

**Matching is exact string equality on the ref.** A `contracts.DOC001` is not a `customers.DOC001`.
Loosening it would invent edges between unrelated contexts, so a consumer that wants a looser match
records the precision it used rather than changing this.

**A broker id comes from the provider's asyncapi contract and is never synthesised.** An edge
without one is an edge whose model did not say.

## Input shapes

Two are accepted: contracts as an object keyed by protocol, and contracts as an array of
`{ kind, expose, call, send, receive, brokerId }`. A shared index that fits one caller is not
shared.

## Running the tests

From this directory:

```bash
node --test
```
