# Use case step order

A use case's main scenario lists its steps. From schema 2.8.92 a step can also say which steps
must be finished before it starts, whether it may be skipped, whether it may happen more than
once, and which business rule explains a constraint on it. A scenario that uses none of these
fields keeps its meaning: each step follows the one listed before it.

Three facts are stated separately, because each can hold without the others:

| Fact | Field | Omitted means |
|---|---|---|
| Which steps must be finished first | `after` | the step listed immediately before |
| Whether the step may be skipped | `optional` | it happens |
| Whether the step may happen more than once | `repeat` | once |

## The fields

| Field | Type | Meaning |
|---|---|---|
| `id` | `UCS` followed by 3 or more digits | Names the step, so that another step of the same main scenario can list it in `after`. Needed only then. |
| `after` | list of step ids, each listed once | The steps that must be finished before this one starts. All of them are required. An empty list says the step needs no predecessor. |
| `optional` | `true` or `false` | `true`: the step happens or is skipped. |
| `repeat` | `true` or `false` | `true`: the step happens one or more times, until the actor finishes it. |
| `rule` | a rule reference, such as `SR001` | The business rule that explains a constraint on this step. |

`step` and `action` stay required, and `operation`, `actor`, `screen`, `ui_action`, `emotion` and
`pain_point` keep their meaning. All five new fields are optional, on the steps of `main_scenario`
only. An alternative flow still names the step it leaves by its number, in its own `step`.

## How the order is read

- A step without `after` must follow the step listed immediately before it. The first listed step
  needs no predecessor.
- A step with `after` follows exactly the steps it names, and no longer the step listed before it.
  `after: []` says it follows nothing.
- A step that names several steps in `after` starts when all of them are finished.
- Two steps neither of which must follow the other happen in either order, one at a time. Freedom
  of order is not concurrency: steps that run at the same time are stated in a process, with its
  activities and joins.
- The list keeps its order for the reader. The `step` number is the label the reader sees and the
  anchor an alternative flow names; the position in the list, not the number, decides which step
  comes before by default.
- A step id belongs to its main scenario. `after` names steps of the same scenario only, and two
  use cases may each have a step `UCS001`. A step without an id can still state `after`; it simply
  cannot be named by another step.

The schema checks the shape of each field: an id is `UCS` and digits, `after` is a list of such
ids with no id twice, `optional` and `repeat` are `true` or `false`, and `rule` is a rule
reference. Validation also resolves `rule` against the rules the model declares. Whether every id
in `after` names a step of the same scenario, and whether the order closes a cycle, are checked
by the semantic rule `use-case-step-order`, along with duplicate scenario-local ids; Archally Pro
runs it as `bp check <project>`, and `bp validate <project>` runs the schema and rule-reference
checks. Schema validation alone does not establish valid precedence.

## A sequence, as before

No new field. Each step follows the one before it.

```yaml
use_cases:
  - id: UC001
    name: Place an order
    primary_actor: ACT001
    main_scenario:
      - step: 1
        action: The customer reviews the cart
      - step: 2
        action: The customer enters a delivery address
      - step: 3
        action: The customer pays
```

## Two steps in either order

The customer can enter the address or choose the payment method first. The second step states
`after: []`, so it no longer follows the first.

```yaml
use_cases:
  - id: UC002
    name: Prepare a checkout
    primary_actor: ACT001
    main_scenario:
      - step: 1
        id: UCS001
        action: The customer enters a delivery address
      - step: 2
        id: UCS002
        action: The customer chooses a payment method
        after: []
```

## A step that waits for several

Confirming the order needs both the address and the payment method. Without `after` on step 3 it
would follow step 2 only, and an order confirmed before its address was entered would read as
valid.

```yaml
use_cases:
  - id: UC003
    name: Confirm a checkout
    primary_actor: ACT001
    main_scenario:
      - step: 1
        id: UCS001
        action: The customer enters a delivery address
      - step: 2
        id: UCS002
        action: The customer chooses a payment method
        after: []
      - step: 3
        action: The customer confirms the order
        after: [UCS001, UCS002]
```

## Optional and repeated steps

```yaml
use_cases:
  - id: UC004
    name: Send a gift
    primary_actor: ACT001
    main_scenario:
      - step: 1
        action: The customer chooses a gift
      - step: 2
        action: The customer adds a recipient
        repeat: true
      - step: 3
        action: The customer attaches a photo
        optional: true
        repeat: true
      - step: 4
        action: The customer writes a gift message
        optional: true
      - step: 5
        action: The customer pays
```

| Step | Happens |
|---|---|
| 2, `repeat: true` | one or more times |
| 3, `optional: true` and `repeat: true` | zero or more times |
| 4, `optional: true` | zero times or once |
| 1 and 5 | once |

A step that must follow a repeated step starts after its last repetition. A repetition is not a
return to an earlier step, so it never needs an `after` that points back.

A skipped optional step counts as finished for the order: step 5 follows step 4, and the customer
who writes no gift message still pays. A skipped step is recorded as skipped rather than done,
and its operation is not performed. A step without `optional: true` is never skipped.

## The rule behind an order

```yaml
use_cases:
  - id: UC005
    name: Fulfil an order
    primary_actor: ACT002
    main_scenario:
      - step: 1
        id: UCS001
        action: The warehouse picks the items
      - step: 2
        id: UCS002
        action: The payment provider confirms the payment
        after: []
      - step: 3
        action: The warehouse ships the order
        after: [UCS001, UCS002]
        rule: SR001
```

`SR001` is a rule the model declares, for example in `rules.yaml`:

```yaml
structural:
  - id: SR001
    name: Ship only paid orders
```

The reference resolves like any other rule reference, with an optional context prefix such as
`fulfilment.SR001`. It documents why step 3 waits for the payment; naming the rule does not make
the scenario enforce it.

## A user story lists operations, not steps

A user story's `operations` is a set: each operation is listed once and the order of the list
means nothing. A story states no order of work; a use case's main scenario or a process does.

A story that lists one operation twice is rejected from 2.8.92. Remove the repeated entry; the
order of the remaining list does not matter.
