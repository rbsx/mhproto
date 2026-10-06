---
name: mhproto-sql
description: Link SQL tables to MHProto rules. Use when a rule depends on a uniqueness, nullability or ownership guarantee in the database schema.
---

# MHProto SQL tables

Read ../mhproto-format/SKILL.md first. Tables come from the `sql` interface in mhproto.yaml. Fetch one with `mhproto context --entity table:NAME`.

Link a table to the rules it enforces with a comment directly above its `CREATE TABLE`: `-- mhproto: DAILY-PLAY-2`. Link an operation to a table it reads or writes with `x-mhproto-links: [table:NAME]` in OpenAPI. Change the migration that owns the table, never a copy. Run `mhproto check`.
