---
name: schema-gotchas
description: >
  Shapes in the Blueprint Schema that commonly trip up an author - map-vs-list collections,
  `name` vs `statement`, item shapes that look like objects but are strings, where `provenance`
  is allowed, and global ID uniqueness. Read when the validator rejects something you expected
  to work, or before authoring a layer you haven't touched before.
---

# Schema gotchas

Each entry states the **shape that fails**, the **shape that works**, and *why* the schema is built
that way - the reasoning matters more than the rule, because it generalizes to shapes not listed here.

Every one of these costs a round of validation if you guess wrong. None are discoverable by reading a
model that already works, because a working model shows only the correct form.

---

## 1. Collections: map form vs list form

Both are valid, and **which one a layer uses is not a matter of taste** - it follows from whether the
entity has a natural, unique, human-meaningful key.

```yaml
# Map form - the key IS the name. Used by `operations:`, `components.schemas:`.
operations:
  PlaceOrder:
    id: CMD001
    kind: command

# List form - items carry their own `id`/`name`. Used by `concepts:`, `actors:`, most governance layers.
concepts:
  - id: CN001
    name: "Order"
```

**How to tell:** open the layer's schema file and look at the container's `type`. `object` with
`additionalProperties` → map form. `array` → list form. Do not infer it from another layer.

**Why:** map form makes the name unique by construction and keeps diffs stable when the collection
grows. List form is used where an entity may need several human labels (`name`, `term`, `title`) or
where ordering carries meaning.

---

## 2. `name` vs `statement` - and other prose carriers

Not every entity calls its prose `description`, and using the wrong key is a **hard error** where
`additionalProperties: false` is set - not a warning.

| Entity | Carries its prose in | Required alongside |
|---|---|---|
| Goal | `statement` | `id`, `priority` |
| Business rule | `statement` | `id` |
| Concept | `description` | `id`, `name` |
| Actor | `description` **or** `summary` | `id` |
| Test case | `summary` or `description` | `id` |

```yaml
# ✗ REJECTED - `name` is not a goal property, and `statement`/`priority` are required
goals:
  - id: G001
    name: "Efficient repair tracking"
    description: "Track every repair from intake to completion."

# ✓
goals:
  - id: G001
    statement: "Track every repair from intake to completion without losing status."
    priority: high
```

**Why:** a goal is a *claim about intent*, not a named thing - the schema forces you to write the claim
rather than a label. When a validator rejects a key you were sure about, open the `$defs` entry and read
its `required` list before changing anything else.

---

## 3. Reference lists hold references, not objects

Fields ending in `_refs`, and typed-reference lists like `governed_by`, hold **plain typed IDs**. It is
tempting to attach metadata to the link; the schema does not allow it.

```yaml
# ✗ REJECTED - the item is a string, not an object
governed_by:
  - rule: BR001
    enforcement: pre-check

# ✓
governed_by: [BR001, BR002]
```

**Why:** one fact in one place. If the *manner* of enforcement matters, it belongs on the rule, not on
every link that points at it - otherwise the same fact gets restated at every reference site and they
drift apart.

---

## 4. `provenance` is a design-plane field

`provenance` records how a piece of the model came to exist (authored / derived / synthesized). It is
allowed on **design-plane** entities. Attaching it to a governance entity that has no such property is
an error.

**Why:** governance entities carry their epistemic status differently - a decision has `certainty` and
`evidence`, which say something stronger than provenance does. Use the layer's own vocabulary.

---

## 5. IDs are globally unique - including across scopes

A typed ID is unique across the **whole model**, not per file, per slice, or per prefix-scope. A
scope prefix (`catalog.CN001`) *disambiguates the reference*; it does **not** create a second numbering
space in which `CN001` is free again.

**Before minting an ID, search the whole model for the prefix and take the next free number.** Do not
assume a fresh file starts at `001`.

Band your IDs if the model is large enough for several authors or several slices - e.g. reserve
`CN001–CN099` for one slice and `CN100–CN199` for another - and write the banding down where the next
author will see it. Collisions surface late, at reference-resolution time, and are tedious to unpick
because every reference has to move with the ID.

---

## 6. Enum-valued fields reject near-misses silently in prose, loudly in YAML

Fields like `task_type`, `kind`, `stereotype`, `purpose` and `certainty` are closed enums. A plausible
synonym (`command-handler` for `command`, `verified` for `validated`) is a hard error. When the
validator rejects an enum value, read the enum list from the schema rather than guessing a near
neighbour - the list is usually shorter and more opinionated than it looks.

---

## 7. When a shape genuinely isn't expressible

If the schema will not hold something the domain really requires, **do not** work around it by
flattening the fact into a description string or inventing a parallel convention. Say so plainly:
name the fact, the layer you'd expect it in, and what you did instead. A recorded gap is useful
signal; a silently mangled model is not.
