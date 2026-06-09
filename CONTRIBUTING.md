# Contributing

Thanks for your interest in gridbase! This is an early open-source project; issues
and PRs are welcome.

## Dev setup

```bash
pnpm install

# Generate the demo migrations + seed.
node scripts/gen-sql.mjs
node scripts/seed.mjs > /tmp/seed.sql

# API: a local D1 (sqlite) + open dev mode.
cd packages/api
echo 'GRID_DEV_OPEN=1' > .dev.vars
cp ../../wrangler.toml.example wrangler.toml          # set a placeholder database_id for local
npx wrangler d1 migrations apply gridbase --local
npx wrangler d1 execute gridbase --local --file=/tmp/seed.sql
npx wrangler dev --port 8799

# Web: point it at the local API.
cd ../../apps/web
GRID_API_URL=http://localhost:8799 pnpm dev
```

## Checks before a PR

```bash
pnpm -r typecheck   # every workspace must typecheck
pnpm test           # vitest (api filter tests + sdk client tests)
cd apps/web && pnpm build
```

If you change `examples/demo-schema.mjs`, re-run `node scripts/gen-sql.mjs` and
commit the regenerated `packages/api/migrations/0002_entities.sql` and
`0003_links.sql` (they're generated, but committed for reviewability).

## Adding a connector (future)

The storage layer lives in `packages/api/src/repo.ts`, which reads/writes by
`meta_fields.column_name`. The plan (see [docs/ROADMAP.md](docs/ROADMAP.md)) is to
extract a `SourceConnector` interface and register implementations by
`meta_tables.source_kind`. A new connector implements
`list` / `get` / `create` / `update` / `remove` / `resolveLinks` over a row
abstraction; the API and UI stay unchanged. If you want to land Postgres/Mongo/
warehouse support, open an issue first to align on the interface.

## Code style

- TypeScript, strict mode. Address fields by stable id (never by name) on the wire.
- Never interpolate user values into SQL — bind them. Validate any interpolated
  identifier (table slug / column) against `^[A-Za-z_][A-Za-z0-9_]*$`.
- Keep the API and UI source-agnostic: no per-entity special-casing.
