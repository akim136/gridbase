/**
 * Demo schema — a neutral example used to bootstrap a gridbase instance.
 *
 * This is the SINGLE SOURCE OF TRUTH for the demo. Both the migration generator
 * (scripts/gen-sql.mjs) and the registry/data seeder (scripts/seed.mjs) read this
 * file, so the physical D1 columns and the meta_fields registry can never drift.
 *
 * It models a small CRM: Companies → Contacts and Companies → Deals, with a
 * single-select (Kanban-able), a date (Calendar-able), and a formula.
 *
 * Field `type` values:
 *   text | longtext | number | date | datetime | select | multiselect |
 *   checkbox | url | email | json | formula | link | lookup
 *
 * Storage rules (consumed by the generator):
 *   - text/longtext/select/url/email/json/date/datetime → TEXT column
 *   - multiselect                                        → TEXT (JSON array)
 *   - number                                             → REAL column
 *   - checkbox                                           → INTEGER (0/1)
 *   - formula / lookup                                   → NO column (computed on read)
 *   - link                                               → NO column (edges in a join table)
 *
 * IDs are opaque and stable (the wire contract): table ids `tbl_` + 16 hex,
 * field ids `fld_` + 16 hex. They are NOT tied to any external system.
 */

// Stable ids (generated once with node:crypto; committed so output is deterministic).
const TBL_COMPANIES = "tbl_1de7f0211bcd7842";
const TBL_CONTACTS = "tbl_7cba1d303a30d289";
const TBL_DEALS = "tbl_6b116201014a93e2";

/**
 * Relations, keyed by join-table name. Each join table has exactly two endpoint
 * columns (a/b) pointing at entity-table slugs. Link fields reference these.
 */
export const RELATIONS = {
  link_company_contacts: { a: "company_id", aTable: "companies", b: "contact_id", bTable: "contacts" },
  link_company_deals: { a: "company_id", aTable: "companies", b: "deal_id", bTable: "deals" },
};

// Shorthand builders to keep the table specs terse and uniform.
const f = (id, name, type, col, options) => ({ id, name, type, col, ...(options ? { options } : {}) });
const sel = (id, name, col, choices) => ({ id, name, type: "select", col, options: { choices } });
const link = (id, name, join, self, other, linkedTableId, relation) => ({
  id, name, type: "link", options: { join, self, other, linkedTableId, relation },
});
const formula = (id, name, spec) => ({ id, name, type: "formula", options: { formula: spec } });
// Lookup: pull a field from the record(s) linked via `viaFieldId`. Computed on read.
const lookup = (id, name, viaFieldId, targetFieldId) => ({
  id, name, type: "lookup", options: { lookup: { via: viaFieldId, target: targetFieldId } },
});
// Rollup: aggregate across record(s) linked via `viaFieldId`. `count` ignores
// targetFieldId; sum/avg/min/max aggregate that numeric target. Computed on read.
const rollup = (id, name, viaFieldId, agg, targetFieldId) => ({
  id, name, type: "rollup", options: { rollup: { via: viaFieldId, agg, ...(targetFieldId ? { target: targetFieldId } : {}) } },
});
const choices = (...names) => names.map((n) => ({ name: n }));

/** @typedef {{id:string,name:string,slug:string,primaryFieldId:string,fields:object[]}} TableSpec */

const FC_NAME = "fld_ed4392298761b5c1";
const FK_COMPANY = "fld_d950621b5fd5199d";
const FD_AMOUNT = "fld_32535ebf764c27b1";
const FD_PROB = "fld_89ae4f65c5851cc6";

/** @type {TableSpec[]} */
export const TABLES = [
  {
    id: TBL_COMPANIES,
    name: "Companies",
    slug: "companies",
    primaryFieldId: FC_NAME,
    fields: [
      f(FC_NAME, "Name", "text", "name"),
      f("fld_22d97673ba4f7144", "Website", "url", "website"),
      sel("fld_c8f13f99023fd2bd", "Industry", "industry",
        choices("SaaS", "Fintech", "Healthcare", "Retail", "Manufacturing", "Other")),
      f("fld_edfbf81650fac732", "Employees", "number", "employees"),
      sel("fld_70c82fef25d03b72", "Status", "status", choices("Lead", "Active", "Churned")),
      f("fld_277b1a34818263ca", "Notes", "longtext", "notes"),
      link("fld_c4b2c9df60aa659c", "Contacts", "link_company_contacts", "company_id", "contact_id", TBL_CONTACTS, "one-to-many"),
      link("fld_f4d4754c0f773ee9", "Deals", "link_company_deals", "company_id", "deal_id", TBL_DEALS, "one-to-many"),
      // Rollups over the Deals link: how many deals, and their total amount.
      rollup("fld_rollup_dealcount", "# Deals", "fld_f4d4754c0f773ee9", "count"),
      rollup("fld_rollup_dealtotal", "Total Deal Amount", "fld_f4d4754c0f773ee9", "sum", FD_AMOUNT),
    ],
  },
  {
    id: TBL_CONTACTS,
    name: "Contacts",
    slug: "contacts",
    primaryFieldId: "fld_5f60d86565fbe7b4",
    fields: [
      f("fld_5f60d86565fbe7b4", "Name", "text", "name"),
      f("fld_2fe91571a0bcd81d", "Email", "email", "email"),
      f("fld_b622cee216e7ea3b", "Title", "text", "title"),
      link(FK_COMPANY, "Company", "link_company_contacts", "contact_id", "company_id", TBL_COMPANIES, "many-to-one"),
    ],
  },
  {
    id: TBL_DEALS,
    name: "Deals",
    slug: "deals",
    primaryFieldId: "fld_72fbfcec5a293bb7",
    fields: [
      f("fld_72fbfcec5a293bb7", "Name", "text", "name"),
      f(FD_AMOUNT, "Amount", "number", "amount"),
      sel("fld_ab8460da74d9c748", "Stage", "stage", choices("New", "Qualified", "Won", "Lost")),
      f(FD_PROB, "Probability", "number", "probability"),
      // Demonstrates the formula engine: bucket the deal amount into a size band.
      formula("fld_c5a3132d2e04f8ea", "Size", {
        expr: "bucket",
        operand: FD_AMOUNT,
        thresholds: [{ gt: 100000, label: "Enterprise" }, { gt: 25000, label: "Mid-Market" }],
        default: "SMB",
      }),
      f("fld_6f0bae1cf3cda9f7", "Close Date", "date", "close_date"),
      link("fld_53fbf97adf9540cf", "Company", "link_company_deals", "deal_id", "company_id", TBL_COMPANIES, "many-to-one"),
      f("fld_93ca3a95669400df", "Owner", "text", "owner"),
    ],
  },
];

/** SQL string literal for a value (NULL or single-quote-escaped). Shared by the
 *  seed + migration generators so the escaping rule lives in one place. */
export function sqlQuote(v) {
  return v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
}

/** SQLite column type for a stored field type. Returns null for link/formula/lookup. */
export function columnType(fieldType) {
  switch (fieldType) {
    case "number": return "REAL";
    case "checkbox": return "INTEGER";
    case "text": case "longtext": case "select": case "multiselect":
    case "url": case "email": case "json": case "date": case "datetime":
      return "TEXT";
    case "link": case "formula": case "lookup": return null; // computed/relational; not stored
    default: throw new Error(`unknown field type: ${fieldType}`);
  }
}

/** All distinct join tables actually referenced by link fields, with endpoints. */
export function usedRelations() {
  const used = new Set();
  for (const t of TABLES) {
    for (const fld of t.fields) {
      if (fld.type === "link") used.add(fld.options.join);
    }
  }
  return [...used].map((name) => {
    const r = RELATIONS[name];
    if (!r) throw new Error(`link field references unknown relation: ${name}`);
    return { name, ...r };
  });
}
