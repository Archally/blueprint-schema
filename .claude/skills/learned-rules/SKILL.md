---
name: learned-rules
description: >
  How this repo records modeling lessons it has already paid for, and how to send a lesson back
  upstream so the next release of the kit carries it. Read at the end of a modeling session, or
  when you hit friction that cost you a round of validation and is likely to recur.
---

# Learned rules

A lesson that lives only in one person's head gets re-learned by everyone else, at full price. This
file is where a lesson stops costing.

Two things live here: **your team's ledger** (grows as you model) and **the route upstream** (so a
lesson that is not specific to your domain reaches the kit itself).

---

## Recording a lesson

Append an entry. Keep the id monotonic - never renumber, because notes elsewhere cite these.

```markdown
### LR003 - Counterpart events are not optional in practice
**Class:** failure
**Cost:** one review cycle; the command looked complete and wasn't.
**Rule:** every state-changing command gets its counterpart event in the same slice.
**Why:** a command without an event is invisible to anything downstream - impact analysis,
event storming projections, and contract generation all read the event, not the command.
```

Four fields, and the two that matter most are the ones people skip:

- **Class** - `failure` (this bit us), `champion` (this worked, keep doing it), or `forbidden`
  (never do this again). A ledger of only failures reads as a list of complaints; champions are
  what a new joiner actually needs.
- **Cost** - what it actually cost. A lesson with no recorded cost gets deprioritised the first
  time someone is busy, because nobody can tell a real scar from a preference.
- **Rule** - imperative, one line.
- **Why** - the reasoning, because it generalizes to shapes not in the ledger. A rule without a
  why is cargo cult, and it will be applied in a situation where it is wrong.

**Record it in the session that earned it.** A lesson written a week later is a summary of a
summary; the specific shape that failed is gone, and the specific shape is the whole value.

---

## Where a lesson belongs

Not every lesson belongs in this file. Route it by what kind of thing it is:

| The lesson is… | Home | Why not here |
|---|---|---|
| A schema shape that trips authors | the `schema-gotchas` skill | already the kit's cheatsheet - adding it here splits one answer across two files |
| Specific to **your** domain or team | **this file** | nobody upstream can act on it |
| A gap in the schema itself | a schema change request, upstream | prose cannot fix a missing field - see below |
| Friction with the kit's tools or prompts | **upstream** - see below | the next kit release should carry the fix |

That third row is the one people get wrong. If the model cannot express something, writing a rule
telling authors to work around it makes the workaround permanent. Say the field is missing.

---

## Sending a lesson upstream

A lesson that is not specific to your domain is worth more to the kit than to you - the next
release carries it for everyone, including you.

1. **Write a friction note** - one file, named `YYYY-MM-DD-<topic>-friction.md`.
2. **Scan it before it leaves.** Friction notes quote real models. Strip entity names, system
   names, customer names, and internal URLs - describe the *shape* that failed, not the instance.
   A note that cannot be de-identified is a note that stays local; say what happened abstractly
   instead of not reporting it.
3. **Include, for each finding:** what you tried · what happened · what you expected · what it
   cost. The cost line is what lets a maintainer rank it against everything else.
4. **Send it** on the same cadence you take anything else upstream - bundled at release prep, not
   as a one-off interrupt.

Findings come back as one of four dispositions: fixed in the kit · scheduled · routed to a schema
change request · rejected with a reason. **Rejected-with-a-reason is a real outcome**, not a
failure of the note - it usually means the behaviour is deliberate, and the reason is itself worth
adding to this ledger.

---

## Seeded rules

### LR001 - "Validation passed" is not "the model is right"
**Class:** forbidden
**Cost:** recurring; the failure mode is silent, so it has no single incident to point at.
**Rule:** never report a model as correct on the strength of a passing validator. State which
level was checked, and which were not.
**Why:** a validator answers a *structural* question - does this conform to the schema, do the
references resolve. It cannot tell you whether a claim is supported by evidence, or whether the
architecture described still matches the code. Those are different checks, and passing the first
says nothing about the last two. The danger is specific to AI-assisted modeling: an agent reads
`PASSED` and confidently reports the architecture as described. Say what was verified and what
was not.

### LR002 - Search before you mint
**Class:** champion
**Cost:** cheap to follow, expensive to skip - duplicates are found in review, after everything
that references them has been written.
**Rule:** before creating an entity, search the model for one that already means this.
**Why:** the cost of a duplicate is not the duplicate - it is that half your references point at
one copy and half at the other, and no single file looks wrong. Merging them later means rewriting
references across slices. Thirty seconds of searching beats it every time. This is also why ids are
globally unique rather than per-file: the model is one graph, not a folder of documents.
