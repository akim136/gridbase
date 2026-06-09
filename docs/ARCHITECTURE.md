# Architecture

gridbase is **metadata-driven**: the schema is data, not code. A registry of
tables, fields, and views describes everything, and the API + UI render and edit
any table from that registry with no per-entity logic.

```
apps/web (Next.js)
  ├─ Server Components ── read ──┐  (GRID_API_SECRET stays server-side)
  └─ app/api/grid/[...path] BFF ─┤  (client mutations attach the Bearer)
                                 ▼
        packages/api (Worker) ── connector ──▶ D1 / SQLite
                  ▲
            packages/sdk (Node or Worker callers)
```

## The registry (`meta_*`)

Three tables, defined in `packages/api/migrations/0001_meta.sql`:

- **`meta_tables`** — one row per table: `table_id` (stable opaque id), `name`,
  `slug` (physical table), `primary_field_id`, `position`, and the connector seam
  `source_kind` / `source_ref`. Carries a nullable `workspace_id`.
- **`meta_fields`** — one row per field: `field_id`, `table_id`, `name`, `type`,
  `column_name` (NULL for computed/relational fields), `options` (JSON: select
  choices, link target, formula/lookup spec), `is_computed`, `is_primary`.
- **`meta_views`** — one row per view: `view_id`, `table_id`, `name`, `type`
  (`table` | `kanban` | `calendar` | `form` | `detail`), and a JSON `config`
  (visible fields + order, filters, sorts, `kanban.stackFieldId`,
  `calendar.dateFieldId`, `form.fieldIds`).

Fields are addressed by **stable id** (`fld_…`) on the wire — that survives
renames and is the contract the SDK relies on.

## Storage layout

Entity tables (`companies`, `contacts`, `deals` in the demo) are concrete typed
tables. Each has `id`, `workspace_id`, one column per stored field, an `extra_json`
escape hatch, and `created_at` / `updated_at`. Relations live in **join tables**
(`link_*`), one row per edge; both sides' link fields read the same join table.

The entity + link migrations (`0002_entities.sql`, `0003_links.sql`) are generated
from the schema spec by `scripts/gen-sql.mjs`, so the physical columns and the
`meta_fields` registry can never drift.

## The API worker (`packages/api`)

A Bearer-gated (`GRID_API_SECRET`) HTTP API over D1. It fails closed (missing
secret → 503); local `wrangler dev` opts in with `GRID_DEV_OPEN=1` in `.dev.vars`.

- `GET /health`, `GET /v1/meta` (the whole registry).
- `GET /v1/tables/:id/records` — `fields`, `sort`, `filter` (structured JSON),
  `pageSize` (≤100), `offset`. Computes formulas and resolves links/lookups on
  read; returns `{ records: [{ id, createdTime, fields }] }`.
- `GET /v1/tables/:id/records/:rid`; `POST` / `PATCH` (`{ records, typecast? }`);
  `DELETE` (`?records[]=…`). Writes reject computed/lookup fields, coerce by type,
  diff link edges, and (with `typecast`) resolve links by primary-field value.
- `POST /v1/views`, `PATCH` / `DELETE /v1/views/:id`.

Internals:
- `meta.ts` loads + caches the schema per isolate (views are read fresh per
  request so the view editor takes effect immediately). It validates every
  interpolated SQL identifier against `^[A-Za-z_][A-Za-z0-9_]*$` so a hostile
  registry row fails loudly instead of becoming an injection sink.
- `repo.ts` is the storage layer — reads/writes by `meta_fields.column_name`,
  resolves links and lookups. **This is the connector boundary**: swapping the SQL
  here for another source is how non-D1 connectors plug in.
- `filter.ts` builds parameterized `WHERE` / `ORDER BY` from the structured filter
  spec (values always bound, never interpolated). `records.ts` evaluates formulas
  and assembles the wire-shaped record.

## The UI (`apps/web`)

A generic Next.js app that renders entirely from `/v1/meta`:
- Server Components read via `lib/server/gridApi.ts` (the Bearer stays on the
  server). Interactive client mutations go through the **BFF** at
  `app/api/grid/[...path]/route.ts`, which attaches the Bearer and proxies to the
  API — so the secret never ships to the browser.
- View components (`TableView`, `KanbanView`, `CalendarView`, `FormRenderer`, the
  detail page) and editing surfaces (`EditableCell`, `LinkPicker`,
  `NewRecordDialog`, `ImportDialog`) are all driven by field metadata.

## The SDK (`packages/sdk`)

A typed client (`GridDataClient`) for the API. It abstracts transport: pass the
global `fetch` (Node, HTTPS + Bearer) or a Worker service binding's `fetch`
(in-process). Records are addressed by field id, matching the wire contract.

## Seams already in place

- **Multi-tenancy:** every entity table and `meta_tables` carry a nullable
  `workspace_id`. The connector layer is the single place to scope queries by it.
- **Connectors:** `meta_tables.source_kind` / `source_ref` describe where a table's
  data lives; `repo.ts` is the boundary to make pluggable. See the
  [roadmap](ROADMAP.md).
