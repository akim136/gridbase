# Deployment

gridbase has two deployable pieces: the **API** (a Cloudflare Worker over D1) and
the **web** app (Next.js, e.g. on Vercel). The API holds the secret; the web app
talks to it server-side and via a thin BFF.

Replace every `<your-...>` placeholder below with your own values.

## 1. Create a D1 database and configure the API Worker

```bash
cp wrangler.toml.example packages/api/wrangler.toml

cd packages/api
npx wrangler d1 create gridbase
# Copy the printed database_id into packages/api/wrangler.toml (database_id = "<your-d1-database-id>").
```

`packages/api/wrangler.toml` uses a dedicated `migrations_table = "grid_migrations"`
so gridbase can coexist with other migration lineages on the same database.

## 2. Generate migrations and the seed

```bash
# from the repo root
node scripts/gen-sql.mjs                 # writes packages/api/migrations/0002_entities.sql + 0003_links.sql
node scripts/seed.mjs > /tmp/seed.sql    # registry rows + demo data
```

Edit `examples/demo-schema.mjs` to model your own tables, then re-run both.

## 3. Set the API secret

```bash
cd packages/api
printf %s '<your-strong-secret>' | npx wrangler secret put GRID_API_SECRET
```

The API **fails closed**: with no `GRID_API_SECRET` set (and not in dev-open mode)
every `/v1` route returns 503. Generate the secret without a trailing newline
(use `printf %s`, not `echo`).

## 4. Apply migrations + seed, then deploy the API

```bash
# Remote (production):
npx wrangler d1 migrations apply gridbase --remote
npx wrangler d1 execute gridbase --remote --file=/tmp/seed.sql
npx wrangler deploy
```

For local testing use `--local` instead of `--remote`, and put `GRID_DEV_OPEN=1`
in `packages/api/.dev.vars` to allow `/v1` without a secret.

After deploy, verify health:

```bash
curl https://<your-api-subdomain>.workers.dev/health    # → {"status":"ok"}
```

## 5. Deploy the web app (Vercel)

Deploy `apps/web` as its own project (its `next.config.mjs` traces from the app
directory, so the app is the deploy root). Set these **server-only** env vars in
the project (Production + Preview):

| Variable          | Value                                                      |
|-------------------|-----------------------------------------------------------|
| `GRID_API_URL`    | `https://<your-api-subdomain>.workers.dev`                |
| `GRID_API_SECRET` | the same secret you set on the API Worker                 |

Neither is exposed to the browser: Server Components read with the Bearer, and the
BFF (`app/api/grid/[...path]`) proxies client mutations with it attached.

## Other sources (roadmap)

Today the only connector is D1/SQLite. The storage layer (`packages/api/src/repo.ts`)
is the boundary where a Postgres / Mongo / warehouse connector plugs in — see
[ROADMAP.md](ROADMAP.md). When that lands, deployment changes only in how the data
source is configured (`source_kind` / `source_ref`), not in the API or UI.
