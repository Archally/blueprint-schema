---
name: blueprint-exchange-binding
description: >
  Use when binding a blueprint slice's operations to their transport - filling the `exchange` +
  `payload` blocks in `domain.yaml` to burn down `missing-exchange-binding` /
  `exchange-missing-payload`, including the async queue and message-bus integration surface.
  Encodes the orthogonal kind-vs-transport principle, the point-to-point (queue) vs publish-subscribe
  (topic) distinction, multi-channel exchange arrays, and the harvest→bind→verify recipe. Invoke after
  the blueprint modeler's orientation, once a slice's domain/concepts exist and you are adding transport.
---

# Blueprint Exchange Binding (Archally v2.7)

Populate each operation's `exchange` (transport) and `payload` (wire model) so the domain model can
generate API/AsyncAPI contracts. The governing principle: **operation `kind` (command/query/event) =
domain semantics; `exchange` = transport. They are orthogonal - never encode a transport fact by
changing `kind`.** Log decisions into the slice's triage report.

## The transport families → binding

The concrete `protocol` values depend on the target system (REST, an in-house RPC seam, a job runner,
a message bus, a pub/sub cache-invalidation channel…). Custom transports use an `x-*` protocol name you
define per system. What is **general** is the binding shape and the queue-vs-topic distinction below.

| Transport family | `protocol` | Binding | Payload |
|---|---|---|---|
| REST controller | `http` | `endpoint: {path, method}` | request model (cmd) / response model (qry) |
| Bespoke RPC seam | `x-rpc` (custom) | `method: {name: "IService.Method"}` | request/response model |
| Durable background-job queue | `x-queue` (custom) | `queue: {name: <lane>}` | job-argument model (**optional** - see below) |
| Point-to-point message bus | `amqp` | `queue: {name: "<entity>.<in\|out>"}` | message model |
| Publish/subscribe channel | `x-topic` (custom) | `topic: {name}` | broadcast signal, often **payload-less** |

### Point-to-point (`queue`) vs publish-subscribe (`topic`) - the EIP distinction
This is the one modelers most often get wrong; it is a genuine Enterprise-Integration-Patterns fact,
not a tooling quirk:
- **Point-to-point / competing consumers** (one message → exactly one consumer; AMQP *Anycast*, a work
  queue, a transactional outbox) → bind as **`queue`**. A durable job queue and a message-bus work queue
  are both `queue`.
- **Publish-subscribe / fan-out** (one message → every subscriber; a cache-invalidation broadcast, a
  domain-event notification) → bind as **`topic`** - the *opposite* of a work queue. Use a topic ONLY for
  genuine cross-process pub/sub, **not** for in-process reads/writes. A topic message is often a bare id,
  so it legitimately stays an `exchange-missing-payload` residual (a `topic` is **not** queue-exempt).
- A **recurring / no-arg** scheduled job is a timer → bind the queue with **no payload** (queue-exempt).

### Multi-channel operations
When an op genuinely rides **more than one** transport (e.g. an HTTP endpoint *and* an async job, or a
REST controller *and* an RPC twin over the same business logic), make `exchange:` a **YAML array** of
exchange objects, with the op-level `payload:` a **sibling** of the array (shared across channels). Two
caveats, both bite:
1. Each array entry allows **only** `protocol`/`endpoint`/`queue`/`method`/`graphql` - `$defs/exchange`
   is `unevaluatedProperties: false`, so a per-channel note lives **inside** `method: {name, description}`
   or `queue: {name, description}`, **never** as a sibling `description:` on the entry.
2. An array does **not** inherit the queue-payload exemption (the `any_non_empty` marker doesn't traverse
   the array), so set the op-level `payload:` or accept an `exchange-missing-payload` residual.

### Expect ops with NO standalone transport - document-unbound, never invent an endpoint
Common categories:
- **Embedded in the parent aggregate body** - a coarse-grained aggregate API where sub-items are set by
  rewriting the parent DTO (not a smell);
- **in-process** compute/branch and in-process events;
- **transport owned by a *different* context** (e.g. approve/reject riding generic approval machinery);
- **phantom** - a domain intent with *no materialization at all* (e.g. an implicit read-time projection,
  no entity/event/endpoint/job);
- **not-found**.
Record the reason in the op `description` (`… hence unbound`) **and** the triage log; a phantom / not-found
gap is usually also worth a finding.

## Recipe (per slice)

1. **Read** the slice `*.domain.yaml` / `*.models.yaml` / `*.concepts.yaml` / findings. Note the
   existing `MDL` models and `CAT` ids (reuse-before-create).
2. **Harvest** (Explore agent, "very thorough"):
   - controller actions → HTTP method + route + request/response DTO type name + file;
   - background jobs → class, queue/lane, enqueue site, argument DTO;
   - pub/sub or bus publish/consume → trigger → outbox → channel/queue → message type;
   - external syncs → shape only.
   Tell the agent to state what it *cannot* find rather than guess.
3. **Bind** each command/query. Insert the `exchange` (+ `payload`) block right after the op's
   `kind:` line (the `id:`+`kind:` pair is a unique, safe Edit anchor). command payload = request
   model; query payload = response/read model. Body-less HTTP (param-only POST/DELETE, GET webhooks)
   binds the `endpoint` with **no payload** (accepted residual - see gotchas).
4. **Models.** Add full `MDL` models for new payloads with concept `CAT` property-maps; use
   `mapping: {strategy: same-names}` when CAT ids aren't independently verified. Reuse existing read
   models for query responses.
5. **Provenance (multi-source).** On async/integration ops record BOTH `code_refs` and
   `provenance.evidence`: `kind: codebase-analysis` (source = code path) AND `kind: documentation`
   (source = a design-doc/wiki URL). There is **no** wiki/ticketing-tool evidence kind - use
   `documentation`, differentiate by `source`.
6. **Boundary hygiene + full modeling is the DEFAULT.** Model the slice's own export / import /
   external-sync jobs as ops in a new `<slice>/integration.domain.yaml` (+ a system actor) **by
   default** - don't gate it behind a "how deep?" question. Only surface a scope question when a
   boundary is genuinely novel/ambiguous. Then: don't duplicate an integration another slice owns;
   cross-context fan-out (identity/external/notifications) and recurring infra/reconciliation jobs →
   fold into a **finding**, not new ops.
7. **Fix wrong code_refs** you discover during harvest (fidelity beats leaving a mis-attribution).
8. **Verify** (below) and **log the slice + decisions** into the triage report.

## Known failures / gotchas

- **Body-less HTTP has no payload affordance.** The `parameter` schema requires a `model_ref` per
  param - too heavy for a plain id path param - so param-only POST/DELETE and GET webhooks stay
  `exchange-missing-payload` residuals. Accept them; note the deferred schema decision. Don't invent
  a payload.
- **The queue-payload exemption is structural.** A queue-bound operation is exempt from
  `exchange-missing-payload` because the rule keys off the presence of `exchange.queue`, not off a
  declared intent. So moving a binding from `method` to `queue` silently changes which findings you
  get - expect the count to move, and read the rule ids rather than the total.
- **`call:` is the caller, never the handler.** `http_client_contract.call` and `rpc_contract.call`
  name operations a service DEPENDS ON, the mirror of `expose:`/`send:`. Binding one to ownership
  records the *caller* as the handler, so a context that merely consumes an operation appears to
  provide it - and provider-side is what every ownership-derived view resolves against.
- **Ownership and transport are different rules.** `unbound-operation` asks which bounded context
  provides an operation; `missing-exchange-binding` and `exchange-missing-payload` ask about transport
  and payload. Binding one moves neither of the others. Read the rule ids rather than the total, or a
  slice that made real progress will look like it made none.
- **Edit duplicate-key trap.** When inserting after a block, include its FULL trailing keys in
  `old_string`, or a leftover key orphans into the next block (a YAML duplicate-key parse error).
- **validator flags `summary` over its cap** (actors/findings). Keep summaries within the cap.
- **Multi-channel array schema error** - a sibling `description:` on an array `exchange` entry throws
  `must NOT have unevaluated properties` + `must be object` + `must match exactly one schema in oneOf`
  (both `oneOf` branches fail). Nest the note inside `method`/`queue` (see the multi-channel section
  above). Arrays also don't inherit the queue-payload exemption - set an op-level `payload:` or accept
  the residual.
- **Model `purpose` enum is closed:** `command-payload | event-payload | read-model | shared | dto`. There
  is **no** `write-model` - a new request/command payload uses **`command-payload`** (query responses reuse
  a `read-model`). Wrong value = a validator schema *error*, not a warning. (Existing read models only show
  `read-model`, so the command value isn't discoverable by copy-paste - this bites.)
- **Point-to-point = `queue`, fan-out = `topic`** - never bind a competing-consumers work queue as a topic,
  and never bind a broadcast as a queue. (Worth capturing as a learned-rule.)

## Verification harness

`SCHEMA_ROOT` is the schema repository's root and `MODEL_DIR` the absolute model path, resolved as the
`blueprint-validate` skill describes:

```bash
MODEL_DIR=<absolute-path-to-model>/.blueprint/v2.8
npm --prefix "$SCHEMA_ROOT" run validate -- "$MODEL_DIR" --schemas "$SCHEMA_ROOT/schema" | grep -iE "^Schema Errors|^Cross-Reference|^PASSED|^FAILED"
npm --prefix "$SCHEMA_ROOT" run check    -- "$MODEL_DIR" | grep -oE '\[[a-z-]+\]' | sort | uniq -c | sort -rn
```

Per slice: 0 schema/xref errors; new `MDL` refs resolve; **no new** `orphan-entities`; slice
`exchange-missing-payload` = body-less / bare-scalar / bulk-id-list / multipart / echo residuals only;
`missing-exchange-binding` drops by the number of ops bound (documented-unbound ops stay as accepted
residuals).

## Pairing

The `blueprint-modeler` agent (orientation, reuse-before-create) and `ddd-modeling` /
`event-storming-modeler` (the domain the transport serves) → this skill (transport) → record the slice
and its decisions in the triage report → `blueprint-validate` (the harness). Standing
`first-principles-thinking`, applied critically: confirm before inventing routes/TO-BE - but full integration modeling is the
**default** depth (step 6), so don't re-ask "how deep?".
