# Syncing improvements from upstream

gridbase was extracted from a private application's "grid" subsystem. Generic
improvements made there (bug fixes, new view types, API hardening) can be ported
here with `scripts/sync-from-upstream.mjs`.

This is a **one-way, opt-in** workflow — it never runs automatically, and it only
touches the generic, shared surface.

## Usage

```bash
# dry-run: report which generic files differ from an upstream checkout
node scripts/sync-from-upstream.mjs --upstream /path/to/upstream

# review the reported drift, then apply:
node scripts/sync-from-upstream.mjs --upstream /path/to/upstream --apply
```

`--upstream` defaults to `$UPSTREAM` or `~/repos/search-system`.

## What it syncs (allowlist)

The registry-driven, backend-agnostic code that is meant to be identical:

- `packages/api/src/{index,repo,records,filter,filter.test,meta,types,views}.ts`
- `apps/web/components/**` and `apps/web/lib/**`
- `apps/web/app/t/[tableId]/[viewId]/**`
- the three generic SDK files: `packages/sdk/src/{formula,grid,grid.test}.ts`

For each, it compares against the upstream counterpart and reports/copies drift.

## What it never touches (protected)

OSS-specific files that intentionally diverge:

- every `package.json` (the `@gridbase/*` names),
- `wrangler.toml.example` (placeholder ids), `.env.example`,
- `examples/demo-schema.mjs` + the generated `packages/api/migrations/*.sql`,
- `docs/**`, `README.md`, `LICENSE`,
- `packages/sdk/src/{index,types}.ts` — the OSS SDK is intentionally backend-agnostic
  (the upstream version carries a second data backend).

## Safety

- **Dry-run by default** — review before `--apply`.
- **Scrub gate** — every file is scanned for private identifiers (account ids, internal
  package scopes, personal emails) before it's written; a match aborts that file.
- **New upstream files are flagged, not auto-added** — review and add them by hand so an
  upstream-specific file never slips in.
- Files that must diverge can be added to the `DENY` set in the script.

## Worked example

The dashboard view type was first built upstream, then ported here — the canonical
first sync. New upstream features follow the same path: run the dry-run, port the new
files/edits, run `pnpm -r typecheck && pnpm test && pnpm -C apps/web build`, then commit.
