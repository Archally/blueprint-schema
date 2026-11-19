# Processes that describe how an organization works

A process can describe the modelled system, or the way the people of an organization do their work.
A product company's "refine and specify an item" is the second kind: a product team refines a
request, a UX team designs it when it needs design, the product team specifies it, and the
specification goes to development. Its activities are work people do in an issue tracker and a
design tool, not operations the system runs. From schema 2.8.88 such a process states
`describes: organization`, and its lanes, activities and provenance carry these facts in typed
fields.

## Choosing the value

| The process | Write |
|---|---|
| is how the system runs something; its activities name operations | nothing, or `describes: system` |
| is how an organization works; its activities are work people do | `describes: organization` |
| sits in a slice that holds only how an organization works | `describes: organization` on the slice, nothing on the process |

A process that states no `describes` takes the value its slice states in `layout.slices`, and
`system` where the slice states none. A process may state its own value inside such a slice. A slice
written as a bare name states none; write it as an object to state `describes`.

```yaml
# blueprint.yaml
layout:
  mode: slices
  slices:
    - name: delivery
      description: How the product, UX and development teams take an item from request to build.
      describes: organization
```

`implementation` keeps its four values. For a process that describes an organization it says
whether the organization works this way yet: `as-is` is how it works today, `to-be` how it means to.

## Lanes for teams

A lane names an actor (a role), a team, or both, the role and the team that staffs it. It names at
least one of the two. `activities` places activities in the lane by their ids, which is how an
activity that names no operation gets a lane.

```yaml
    lanes:
      - team: TM001                     # Product Team
        activities: [delivery.PA001, delivery.PA003, delivery.PA004]
      - team: TM002                     # UX Team
        actor: delivery.ACT001          # UX Designer, the role the team staffs
        activities: [delivery.PA002]
```

## What an activity takes, produces and uses

| Field | Each entry | Meaning |
|---|---|---|
| `inputs` | `name`, optional `concept` | what the activity takes to do its work |
| `outputs` | `name`, optional `concept` | what it produces |
| `tools` | `name`, optional `party` | the tools people use for it; `party` is a party of `kind: system` |

A name alone is a complete statement for an artifact or a tool the model does not declare. A name has
at least one non-space character and is never a typed id: a declared concept or party goes in
`concept` or `party`.

```yaml
      - id: delivery.PA001
        name: Refine the item
        inputs:
          - name: Raw request
        outputs:
          - name: Specification draft
            concept: delivery.CN001     # Specification
        tools:
          - name: Jira
            party: delivery.PRT010      # Issue tracker, kind: system
```

## Where the work is handed over

Inside a process, the lanes and the order of the activities state every handover: when the next
activity sits in another lane, the work changes hands. `hands_over_to` repeats such a handover where
the YAML should show it, and names a receiver outside the process, which nothing else can state.

| Entry | Names |
|---|---|
| `activity` | the receiving activity of the same process |
| `process` | another process the work goes on in |
| `team` | the team that receives the work; beside `activity`, the team of that activity's lane |
| `name` | a receiver as the source states it, for one the model does not declare |

An entry names at least one of the four, and never an activity and another process together. The
list is never empty and never repeats an entry. Where a gateway follows the activity, the handover
belongs to one branch: name the activity that branch leads to.

```yaml
      - id: delivery.PA001
        name: Refine the item
        gateway: xor
        next:
          - to: delivery.PA002
            condition: the item needs UX design
          - to: delivery.PA003
            condition: the item needs no UX design
        hands_over_to:
          - activity: delivery.PA002    # Design the item, in the UX lane
      - id: delivery.PA004
        name: Hand over to development
        hands_over_to:
          - process: delivery.PRC002    # Build the item
```

## Questions and gates at an activity

Some questions are asked every time the work reaches an activity, such as "who reads this page?",
and some conditions must hold before the work goes on, such as "the page passes the accessibility
check". An activity states the first in `questions` and the second in `gates`. Each item has a `key`,
lowercase words joined by hyphens and unique among the questions or among the gates of that
activity, so a record of one run can cite it as `PA001/audience` or `PA012/release`.

| Field | Each entry | Meaning |
|---|---|---|
| `questions` | `key`, `statement`, optional `asked_by`, `asked_of`, `answer` | a question asked at every run: who asks it (an actor), who answers it (an actor or a team) and where the answer is recorded (`name`, optional `concept`) |
| `gates` | `key`, `criterion`, optional `evaluated_by`, `rule`, `evidence`, `on_fail` | a pass or fail condition: who judges it (an actor or a team), the declared rule that states it, what shows the result (`name`, optional `concept`) and the activity the work goes to when it fails |

`key` with `statement`, or `key` with `criterion`, is a complete entry. A criterion that several
gates share, or that test cases verify, is a rule the model declares, and each gate names it in
`rule`: a test case that verifies the rule then reaches every gate that names it. `on_fail` names an
activity this activity leads to through `next`, so the order of the process has a path for the
failure.

```yaml
      - id: delivery.PA001
        name: Refine the item
        questions:
          - key: audience
            statement: Who reads the specification?
            asked_of: TM001             # Product Team
            answer:
              name: Specification draft
              concept: delivery.CN001   # Specification
      - id: delivery.PA002
        name: Review the specification
        gateway: xor
        next:
          - to: delivery.PA003
            condition: the specification is accepted
          - to: delivery.PA001
            condition: the specification is not accepted
        gates:
          - key: accepted
            criterion: The product team accepts the specification
            evaluated_by: TM001
            rule: delivery.VR001        # Specification passes review
            evidence:
              name: Review record
            on_fail: delivery.PA001     # back to Refine the item
```

A question asked at every run is not an open question about the model. A question the modeller has
about the activity, which is answered once and then resolved, is an inquiry whose `affects` names
the activity (see below).

The model graph draws an `activity_question` edge from the process to each actor, team or concept a
question names, and an `activity_gate` edge to each actor, team, rule or concept a gate names. Each
edge carries the activity, the item's key and the field it comes from, so the gates of a process
can be listed by their judge or their rule.

## Fact, hypothesis and unknown

A process and an activity may state `provenance`, the same definition design entities use:
`discovery_stage`, `certainty` and `evidence`.

| What the model knows | Write |
|---|---|
| a fact, observed or confirmed | `provenance` with `discovery_stage: validated` or `committed` and its evidence |
| a hypothesis | `provenance` with `discovery_stage: hypothesis`, `certainty: speculative` or `probable`, and the evidence it rests on |
| an open question | an inquiry whose `affects.process_activity_refs` (or `process_refs`) names the element |

Absent provenance states nothing: it is not a claim that the element is fact. There is no `unknown`
value; an unknown is a question with an owner and a status, so it is an inquiry.

```yaml
      - id: delivery.PA002
        name: Design the item
        provenance:
          discovery_stage: hypothesis
          certainty: speculative
          evidence:
            - kind: interview
              summary: One product manager.
```

```yaml
# delivery/motivation.yaml
inquiries:
  - id: delivery.INQ001
    statement: Who approves the agreed specification?
    category: organizational
    status: open
    affects:
      process_activity_refs: [delivery.PA003]   # Specify the item
```

An inquiry names an activity by the exact id its process declares, so it names one activity only
where no other process declares the same id.

## Moving facts out of `properties`

A model that kept these facts in `properties` moves them by hand:

```yaml
# before
      - id: delivery.PA002
        name: Design the item
        properties:
          discovery_stage: hypothesis
          certainty: speculative
# after
      - id: delivery.PA002
        name: Design the item
        provenance:
          discovery_stage: hypothesis
          certainty: speculative
```

## What validation checks

| The model | The result |
|---|---|
| states `describes` with `system` or `organization`, on a process or a slice | valid |
| states any other value of `describes` | a schema error at `describes` |
| a lane names neither `actor` nor `team` | a schema error at the lane |
| an input, output or tool has no `name`, a blank name, or a typed id as its name | a schema error at the entry |
| `hands_over_to: []`, or an entry naming no receiver | a schema error at the list or the entry |
| a handover entry names `activity` and `process` together | a schema error at the entry |
| a question without `key` or `statement`, a gate without `key` or `criterion`, or a key that is not lowercase words joined by hyphens | a schema error at the entry |
| names a team, actor, rule, activity, process, concept or party nothing declares | a cross-reference error at the reference |

Schema and reference validation resolve each id across the model by its exact string; they do not
check that an activity belongs to the same process or that a party is of `kind: system`. The semantic
check reports two of the question and gate cases: a key that repeats among the questions or among
the gates of one activity is an error (`activity-item-key-repeated`), and an `on_fail` that names an
activity this activity does not lead to is a warning (`gate-on-fail-not-a-successor`).

A process that states none of these fields validates exactly as it did before 2.8.88 and keeps its
meaning, and needs no migration. Validators older than 2.8.88 reject a process, activity, lane,
slice or inquiry that carries them. `questions` and `gates` are accepted from 2.8.102, and older
validators reject an activity that states them.
