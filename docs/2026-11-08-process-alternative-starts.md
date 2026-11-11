# Alternative process starts

A process can begin in more than one way. A release may start when the backend is ready first, or
when the frontend is ready first; an order may arrive from a customer or be keyed in by a clerk.
From schema 2.8.87 a process states these alternative starts in `triggers`, and each start names the
activity it leads to.

## Choosing the form

| The process | Write |
|---|---|
| has one start | `trigger`, as before. Nothing changes for it. |
| has several alternative starts | `triggers`, one entry per start, each with `to`. |
| has no start worth stating | neither. |

A process states `trigger` or `triggers`, never both. A model may mix the two forms across its
processes.

## The shape of a start

Each entry of `triggers` carries the fields of a single `trigger` and one more:

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `message`, `timer`, `signal`, `manual` or `conditional`. |
| `to` | yes | The `id` of the activity this start leads to, an activity of the same process. |
| `operation` | no | The operation that starts the process this way. A message or signal start names the operation that carries it. |
| `schedule` | no | When a timer start fires: an ISO 8601 date, date-time, duration or repeating interval, or a cron expression. |
| `description` | no | The start in words. |

The list is never empty and never repeats a start. For a single `trigger`, the entry activity
follows from its `operation`; for a start in `triggers`, the entry activity is `to`, whichever
activity holds the operation.

## Distinct entries that meet later

Each start leads into its own first activity. The routes meet only where the activities say so:
each entry activity states its successor in `next`, and the activity where the routes meet states
how they converge in `join`. Alternative starts mean any one of them begins the process, so the
routes meet with `join: {mode: xor}`.

```yaml
processes:
  - id: release.PRC001
    title: Release a change
    triggers:
      - type: manual
        to: release.PA001
        description: The backend is ready first
      - type: manual
        to: release.PA002
        description: The frontend is ready first
    activities:
      - id: release.PA001
        name: Ship the backend first
        next: [{to: release.PA003}]
      - id: release.PA002
        name: Ship the frontend first
        next: [{to: release.PA003}]
      - id: release.PA003
        name: Verify the release
        join: {mode: xor}
    end_states:
      - name: Release verified
        type: complete
        from: [release.PA003]
```

Starts are never chained to one another by the order they are listed in, and the order of the
activities does not join them either. State every link between the entry activities and what
follows them.

## Several starts into one activity

Two starts may lead to the same activity. A release that a person can start by hand, or that the
weekly window opens, begins in one place:

```yaml
    triggers:
      - type: manual
        to: release.PA001
        description: A person starts the release
      - type: timer
        schedule: "0 6 * * 1"
        to: release.PA001
        description: The weekly window opens
```

## What a list of starts does not say

- **That the starts happen together.** Two starts are alternatives. A process that must wait for
  two things before it can continue has one start and an `and` join further on.
- **That the process branches.** A choice made after the process began is a fork: one activity with
  `gateway` and several `next` entries. Use `triggers` only when the process itself begins in
  different places.

## What validation checks

| The model | The result |
|---|---|
| states `triggers` with one or more starts, each with `type` and `to` | valid |
| states `triggers: []` | a schema error at `triggers`; omit the list instead |
| repeats a start | a schema error at `triggers` |
| leaves `to` out, or writes an activity's name in it | a schema error at the start |
| states both `trigger` and `triggers` | a schema error at `trigger` |
| names an activity no process declares | a cross-reference error at the start's `to` |
| names an activity of another process | passes schema and reference validation, which resolve ids across the model; semantic rule `process-starts` rejects the foreign target and names its start and source path |

A process with a single `trigger` validates exactly as it did before 2.8.87, and needs no
migration. Validators older than 2.8.87 reject a process that carries `triggers`.
