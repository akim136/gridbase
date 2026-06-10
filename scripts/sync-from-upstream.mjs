#!/usr/bin/env node
/**
 * sync-from-upstream — port generic grid improvements from a private upstream
 * checkout into this OSS repo. Dry-run by default; pass --apply to copy.
 *
 *   node scripts/sync-from-upstream.mjs [--apply] [--upstream <path>]
 *
 * It compares the GENERIC, shared surface (the registry-driven API, the UI
 * components/lib, and the three backend-agnostic SDK files) against an upstream
 * checkout and reports drift. OSS-specific files are NOT mapped and so are never
 * touched: package.json names (@gridbase/*), wrangler.toml.example, the demo
 * schema + generated migrations, docs, and the Airtable-free SDK shim
 * (packages/sdk/src/{index,types}.ts).
 *
 * Safety:
 *   - dry-run by default — review the reported drift before --apply;
 *   - every copied file is SCRUBBED for private identifiers; the sync refuses to
 *     write a file that carries one;
 *   - new upstream files are FLAGGED for manual review, never auto-added;
 *   - files in DENY are skipped even if they drift (intentionally divergent).
 *
 * See docs/SYNC.md.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OSS = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ui = args.indexOf("--upstream");
const UPSTREAM = (ui >= 0 && args[ui + 1]) || process.env.UPSTREAM || join(process.env.HOME, "repos/search-system");

// upstream dir → OSS dir; files inside are matched 1:1 by relative name.
const DIR_MAP = [
  ["workers/grid-api/src", "packages/api/src"],
  ["apps/grid/components", "apps/web/components"],
  ["apps/grid/lib", "apps/web/lib"],
  ["apps/grid/app/t/[tableId]/[viewId]", "apps/web/app/t/[tableId]/[viewId]"],
];
// Individual generic SDK files (the rest of the SDK is intentionally divergent).
const FILE_MAP = [
  ["packages/data-client/src/formula.ts", "packages/sdk/src/formula.ts"],
  ["packages/data-client/src/grid.ts", "packages/sdk/src/grid.ts"],
  ["packages/data-client/src/grid.test.ts", "packages/sdk/src/grid.test.ts"],
];
// OSS relpaths to skip even if they drift (intentionally divergent from upstream).
const DENY = new Set([
  // add files here if they must diverge from upstream, e.g. an OSS-only env shim.
]);

// Identifiers that must never reach this public repo. The committed list is
// STRUCTURAL — it matches the *shape* of risky ids, so no literal private value
// lives in this file. Project-specific exact strings (an internal package scope,
// account names, author PII) belong in a gitignored `.sync-scrub` (one JS regex
// per line, `#` comments allowed), which is read here if present.
function loadLocalScrub() {
  const p = join(OSS, ".sync-scrub");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")).map((s) => new RegExp(s));
}
const SCRUB = [
  /\bapp[A-Za-z0-9]{14}\b/,                                           // Airtable base id shape
  /\b(tbl|fld)[A-Za-z0-9]{14}\b/,                                     // Airtable table/field id shape
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, // a literal UUID (real db/account ids; placeholders use <...>)
  ...loadLocalScrub(),
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// Pairs: every file we ALREADY have in OSS that maps to an upstream file.
const pairs = [];
for (const [uDir, oDir] of DIR_MAP) {
  const base = join(OSS, oDir);
  for (const ossPath of walk(base)) {
    const rel = ossPath.slice(base.length + 1);
    pairs.push({ up: join(UPSTREAM, uDir, rel), oss: ossPath, label: join(oDir, rel) });
  }
}
for (const [u, o] of FILE_MAP) pairs.push({ up: join(UPSTREAM, u), oss: join(OSS, o), label: o });

let drift = 0, applied = 0, ossOnly = 0, blocked = 0;
for (const { up, oss, label } of pairs) {
  if (DENY.has(label)) continue;
  if (!existsSync(up)) { ossOnly++; continue; }
  if (sha(up) === sha(oss)) continue;
  drift++;
  const content = readFileSync(up, "utf8");
  const hit = SCRUB.find((re) => re.test(content));
  if (hit) { console.error(`  ✗ ${label} — SCRUB BLOCKED (matches ${hit})`); blocked++; continue; }
  if (APPLY) { writeFileSync(oss, content); applied++; console.log(`  ✓ synced ${label}`); }
  else console.log(`  Δ ${label} — differs from upstream`);
}

// New upstream files (present upstream, absent in OSS) — flag for manual review.
for (const [uDir, oDir] of DIR_MAP) {
  const base = join(UPSTREAM, uDir);
  for (const upPath of walk(base)) {
    const rel = upPath.slice(base.length + 1);
    if (!existsSync(join(OSS, oDir, rel))) console.log(`  + ${join(oDir, rel)} — NEW upstream file (review + add manually)`);
  }
}

console.log(`\n${APPLY ? `applied ${applied}` : `${drift} file(s) differ`}${blocked ? `, ${blocked} BLOCKED by scrub` : ""}, ${ossOnly} OSS-only. upstream=${UPSTREAM}`);
if (blocked) process.exit(1);
