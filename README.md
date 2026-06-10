# gridbase — an open-source Airtable that fronts your own database

[![CI](https://github.com/akim136/gridbase/actions/workflows/ci.yml/badge.svg)](https://github.com/akim136/gridbase/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

gridbase is a metadata-driven, database-backed workspace. It gives you Airtable's
spreadsheet-meets-database experience — tables, multiple views, relations,
formulas, lookups, filters, and inline editing — **over your own data source**
instead of a captive store.

The whole UI and API render from a registry (`meta_tables` / `meta_fields` /
`meta_views`), so there is zero per-entity code: define your tables as metadata and
everything renders and edits generically. The storage sits behind a thin connector
boundary (D1/SQLite today; Postgres, Mongo, and read-only warehouses on the
[roadmap](docs/ROADMAP.md)) — that connector layer is the differentiator versus
other open-source Airtable clones, which own their database.

## Features

- **Views:** Table (inline-editable grid), Kanban (drag-to-restack), Calendar
  (month grid, drag-to-reschedule), Detail panel, and Form (focused entry).
- **Relations:** linked records with searchable link pickers; click through to
  navigate; collapsible long link lists.
- **Formulas & lookups:** declarative `sum` / `ratio` / `bucket` formulas computed
  on read; lookups that pull a field across a link.
- **Filters, sorts, freeze:** per-view saved filters, sorts, and field
  show/hide/reorder; freeze header row and leading columns.
- **Editing:** inline cell editing per type, add/delete records, a new-record
  modal, and **CSV import** (column → field mapping, chunked create).
- **Field types:** text, longtext, number, date, datetime, single/multi select,
  checkbox, url, email, json, formula, link, lookup.
- **Seams for production:** every entity table carries a nullable `workspace_id`
  (multi-tenant seam) and `meta_tables.source_kind` / `source_ref` (connector seam).

## Architecture (at a glance)

```
apps/web  (Next.js)
  ├─ Server Components ── read ──┐  (GRID_API_SECRET stays server-side)
  └─ app/api/grid/[...path] BFF ─┤  (client mutations; attaches the Bearer)
                                 ▼
        packages/api (Cloudflare Worker, binds D1) ──▶ D1 / SQLite
```

- `packages/api` — a Bearer-gated HTTP API over D1. Reads the registry, computes
  formulas, resolves links/lookups, applies filters/sorts, and handles writes.
- `apps/web` — the Next.js UI. Renders entirely from `/v1/meta`; a thin BFF proxies
  client mutations so the API secret never reaches the browser.
- `packages/sdk` — a typed client for the API, usable from Node (HTTPS + Bearer) or
  inside a Worker (service binding).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

## Quick start (Cloudflare Workers + D1)

```bash
pnpm install

# 1. Create a D1 database and wire up the api Worker.
cp wrangler.toml.example packages/api/wrangler.toml
cd packages/api && npx wrangler d1 create gridbase   # paste the id into wrangler.toml

# 2. Generate the demo migrations + seed.
cd ../.. && node scripts/gen-sql.mjs
node scripts/seed.mjs > /tmp/seed.sql

# 3. Apply migrations + seed (use --local for the wrangler dev sqlite).
cd packages/api
npx wrangler d1 migrations apply gridbase --local
npx wrangler d1 execute gridbase --local --file=/tmp/seed.sql

# 4. Run the api locally (open, no secret) and the web app.
echo 'GRID_DEV_OPEN=1' > .dev.vars
npx wrangler dev --port 8799
# in another shell:
cd ../../apps/web && GRID_API_URL=http://localhost:8799 pnpm dev
```

Open the web app and you'll see the demo CRM (Companies / Contacts / Deals) with
Table, Kanban, and Calendar views.

To deploy, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Repo layout

```
apps/web            Next.js UI (@gridbase/web)
packages/api        HTTP data API — Cloudflare Worker over D1 (@gridbase/api)
packages/sdk        typed client for the API (@gridbase/sdk)
examples/           demo-schema.mjs — a neutral CRM example
scripts/            gen-sql.mjs (emit migrations), seed.mjs (registry + demo data)
docs/               ARCHITECTURE, DEPLOYMENT, ROADMAP
```

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
