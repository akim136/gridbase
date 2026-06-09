# Roadmap

gridbase's core (registry-driven API + generic UI + SDK) is already
source-agnostic in shape. The roadmap closes the gaps between "self-host the demo"
and "a product you'd build a workspace on."

## 1. Dynamic, user-created schema

Today the registry + concrete entity tables are generated/seeded from
`examples/demo-schema.mjs` at deploy time. The product lets users **create tables
and fields from the UI**. Two storage strategies:

- **Generic row store (recommended for v1):** one `records(table_id, id,
  workspace_id, data JSON)` table; fields live only in `meta_fields`; reads/writes
  index into the JSON blob. No per-table DDL → creating a table/field is a pure
  metadata write. (Add indexes on hot JSON paths later.)
- **Runtime DDL:** keep concrete typed tables and emit `ALTER` / `CREATE` on
  field/table creation. Faster queries, heavier operationally.

`repo.ts` already reads/writes by `meta_fields.column_name`, so swapping the
storage behind it is the connector boundary (below). Add meta-write endpoints
(`POST/PATCH/DELETE /v1/tables` and `/v1/fields`) and wire in the existing
`invalidateRegistry()`.

## 2. The source connector (the headline feature)

"Front any SQL/NoSQL/warehouse source." `meta_tables.source_kind` / `source_ref`
already exist. Define a `SourceConnector` interface —
`list` / `get` / `create` / `update` / `remove` / `resolveLinks` over a `RecordRow`
abstraction — and extract the current D1 SQL from `repo.ts` into a `D1Connector` as
the first implementation. The API depends on the interface, never D1 directly.
Then add a `PostgresConnector` (via Hyperdrive or `pg`), a read-only
`WarehouseConnector` (BigQuery/Snowflake), a `MongoConnector`, etc. The registry
types, filter spec, formula spec, and link resolution stay source-agnostic.

This connector layer over arbitrary sources is the differentiator versus other
open-source Airtable clones, which own their database.

## 3. Auth & multi-tenancy

Every entity table and `meta_tables` already carry a nullable `workspace_id`. Add
`users` / `workspaces` tables and real auth (today the model relies on a shared
Bearer + host-level gating), and scope every connector query by `workspace_id`.
The connector interface is the single choke point to enforce isolation.

## 4. Public / shareable forms

Internal form views exist (`/f/[viewId]`, behind app auth). Public submission needs
an unauthenticated path plus a scoped, create-only submit token.

## Smaller items

- **Dashboards:** `meta_views.type = 'dashboard'` + an aggregation endpoint + charts.
- **Attachments / file fields.**
- **Richer formula engine** (more expressions, cross-field references).
- **Webhooks / automations**, **API keys**, **audit log**.
