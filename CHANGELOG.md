# Blueprint Schema Changelog

The release ledger. Every schema version, newest first, one file per minor line.

| Line | Status | Latest | Dated | Entries |
|---|---|---|---|---|
| [`v2.8`](changelog/v2.8.yaml) | active | 2.8.14 | 2026-09-10 | 16 |
| [`v2.7`](changelog/v2.7.yaml) | shipped, superseded | 2.7.18 | 2026-09-08 | 18 |
| [`v2.6`](changelog/v2.6.yaml) | shipped, superseded | 2.6.3 | 2026-05-09 | 4 |

Each entry states what a version changed and what a document valid under the previous one has
to do about it. A breaking change says so in its own first sentence.

The schema tree each line describes is under [`schema/`](schema/), and the structural view of
how the current line is built is the [Atlas changelog](tools/schema-atlas/).
