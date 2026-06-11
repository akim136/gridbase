import { describe, expect, it } from "vitest";
import { buildOrderBy, buildWhere } from "./filter.js";
import type { FieldMeta, Registry, TableMeta } from "./types.js";

function field(partial: Partial<FieldMeta> & { fieldId: string; type: FieldMeta["type"] }): FieldMeta {
  return {
    tableId: partial.tableId ?? "t", name: partial.fieldId, columnName: partial.columnName ?? null,
    position: 0, options: partial.options ?? null, isComputed: false, isPrimary: false,
    ...partial,
  };
}

const allFields: FieldMeta[] = [
  field({ fieldId: "fNum", type: "number", columnName: "num" }),
  field({ fieldId: "fTxt", type: "text", columnName: "txt" }),
  field({ fieldId: "fChk", type: "checkbox", columnName: "chk" }),
  field({ fieldId: "fDt", type: "datetime", columnName: "dt" }),
  field({ fieldId: "fLink", type: "link", options: { join: "lj", self: "a_id", other: "b_id", linkedTableId: "t2" } }),
  field({ fieldId: "fFormula", type: "formula", columnName: null }),
  // Linked table (t2 = companies) fields
  field({ fieldId: "fCoName", type: "text", tableId: "t2", columnName: "co_name", isPrimary: true }),
  field({ fieldId: "fCoTier", type: "text", tableId: "t2", columnName: "tier" }),
  // A lookup that pulls the linked company's name via fLink.
  field({ fieldId: "fLookup", type: "lookup", options: { lookup: { via: "fLink", target: "fCoName" } } }),
];

const tables: TableMeta[] = [
  { tableId: "t", workspaceId: null, name: "Roles", slug: "tbl", primaryFieldId: "fTxt", position: 0, sourceKind: "table", sourceRef: null },
  { tableId: "t2", workspaceId: null, name: "Companies", slug: "companies", primaryFieldId: "fCoName", position: 1, sourceKind: "table", sourceRef: null },
];

const reg: Registry = {
  tables,
  fieldsByTable: new Map([
    ["t", allFields.filter((f) => f.tableId === "t")],
    ["t2", allFields.filter((f) => f.tableId === "t2")],
  ]),
  fieldById: new Map(allFields.map((f) => [f.fieldId, f])),
  views: [],
  dashboards: [],
};

const where = (conds: unknown[]) =>
  buildWhere({ conjunction: "and", conditions: conds as never }, reg, "tbl");

describe("buildWhere", () => {
  it("skips a value-requiring op with no value (half-built filter row)", () => {
    expect(where([{ fieldId: "fTxt", op: "is" }])).toEqual({ sql: "", binds: [] });
  });

  it("isEmpty on a number checks NULL only (a stored 0 is not empty)", () => {
    expect(where([{ fieldId: "fNum", op: "isEmpty" }]).sql).toBe(`WHERE "num" IS NULL`);
  });

  it("isEmpty on text checks NULL or empty string", () => {
    expect(where([{ fieldId: "fTxt", op: "isEmpty" }]).sql).toBe(`WHERE ("txt" IS NULL OR "txt" = '')`);
  });

  it("before on a datetime truncates both sides to the day", () => {
    const r = where([{ fieldId: "fDt", op: "before", value: "2026-06-09" }]);
    expect(r.sql).toBe(`WHERE date("dt") < date(?)`);
    expect(r.binds).toEqual(["2026-06-09"]);
  });

  it("checkbox is=true → col = 1; is=false → null/0", () => {
    expect(where([{ fieldId: "fChk", op: "is", value: true }]).sql).toBe(`WHERE "chk" = 1`);
    expect(where([{ fieldId: "fChk", op: "is", value: false }]).sql).toBe(`WHERE ("chk" IS NULL OR "chk" = 0)`);
  });

  it("link isEmpty / membership use correlated EXISTS over the join table", () => {
    expect(where([{ fieldId: "fLink", op: "isEmpty" }]).sql).toBe(`WHERE NOT EXISTS (SELECT 1 FROM lj WHERE lj.a_id = tbl.id)`);
    const m = where([{ fieldId: "fLink", op: "anyOf", value: ["recX"] }]);
    expect(m.sql).toBe(`WHERE EXISTS (SELECT 1 FROM lj WHERE lj.a_id = tbl.id AND lj.b_id IN (?))`);
    expect(m.binds).toEqual(["recX"]);
  });

  it("link membership with no value is skipped, not treated as match-nothing", () => {
    expect(where([{ fieldId: "fLink", op: "is" }])).toEqual({ sql: "", binds: [] });
  });

  it("skips formula/unknown fields", () => {
    expect(where([{ fieldId: "fFormula", op: "is", value: 1 }, { fieldId: "nope", op: "is", value: 1 }])).toEqual({ sql: "", binds: [] });
  });

  it("ANDs multiple conditions with bound params", () => {
    const r = where([{ fieldId: "fTxt", op: "is", value: "x" }, { fieldId: "fNum", op: "gt", value: 5 }]);
    expect(r.sql).toBe(`WHERE "txt" = ? AND "num" > ?`);
    expect(r.binds).toEqual(["x", 5]);
  });

  // ---- Feature C: nested AND/OR groups -------------------------------------

  it("nested group: A AND (B OR C) wraps the group clauses in parens", () => {
    const r = where([
      { fieldId: "fTxt", op: "is", value: "x" },
      {
        conjunction: "or",
        conditions: [
          { fieldId: "fNum", op: "gt", value: 5 },
          { fieldId: "fNum", op: "lt", value: 0 },
        ],
      },
    ]);
    expect(r.sql).toBe(`WHERE "txt" = ? AND ("num" > ? OR "num" < ?)`);
    expect(r.binds).toEqual(["x", 5, 0]);
  });

  it("top-level OR over a group and a leaf", () => {
    const r = buildWhere(
      {
        conjunction: "or",
        conditions: [
          { conjunction: "and", conditions: [{ fieldId: "fTxt", op: "is", value: "a" }, { fieldId: "fNum", op: "gt", value: 1 }] },
          { fieldId: "fChk", op: "is", value: true },
        ],
      } as never,
      reg,
      "tbl",
    );
    expect(r.sql).toBe(`WHERE ("txt" = ? AND "num" > ?) OR "chk" = 1`);
    expect(r.binds).toEqual(["a", 1]);
  });

  // ---- Feature A: linked-field WHERE (EXISTS over the link join) ------------

  it("linked sub-field: link + linkedFieldId → correlated EXISTS joining the linked table", () => {
    const r = where([{ fieldId: "fLink", linkedFieldId: "fCoName", op: "is", value: "Acme" }]);
    expect(r.sql).toBe(
      `WHERE EXISTS (SELECT 1 FROM lj j JOIN companies lt ON lt.id = j.b_id WHERE j.a_id = tbl.id AND lt."co_name" = ?)`,
    );
    expect(r.binds).toEqual(["Acme"]);
  });

  it("linked sub-field contains uses LIKE inside the EXISTS subquery", () => {
    const r = where([{ fieldId: "fLink", linkedFieldId: "fCoTier", op: "contains", value: "S" }]);
    expect(r.sql).toBe(
      `WHERE EXISTS (SELECT 1 FROM lj j JOIN companies lt ON lt.id = j.b_id WHERE j.a_id = tbl.id AND lt."tier" LIKE ?)`,
    );
    expect(r.binds).toEqual(["%S%"]);
  });

  it("lookup field filters through its via-link to the target column (no explicit linkedFieldId)", () => {
    const r = where([{ fieldId: "fLookup", op: "is", value: "Acme" }]);
    expect(r.sql).toBe(
      `WHERE EXISTS (SELECT 1 FROM lj j JOIN companies lt ON lt.id = j.b_id WHERE j.a_id = tbl.id AND lt."co_name" = ?)`,
    );
    expect(r.binds).toEqual(["Acme"]);
  });
});

describe("buildOrderBy", () => {
  it("stored columns sort directly", () => {
    expect(buildOrderBy([{ fieldId: "fTxt", direction: "desc" }], reg, "tbl")).toBe(`ORDER BY "txt" DESC`);
  });

  it("skips formula/unsortable fields with no column", () => {
    expect(buildOrderBy([{ fieldId: "fFormula", direction: "asc" }], reg, "tbl")).toBe("");
  });

  it("linked sub-field sorts by a correlated scalar subquery over the linked table", () => {
    const sql = buildOrderBy([{ fieldId: "fLink", linkedFieldId: "fCoName", direction: "asc" }], reg, "tbl");
    expect(sql).toBe(
      `ORDER BY (SELECT lt."co_name" FROM lj j JOIN companies lt ON lt.id = j.b_id WHERE j.a_id = tbl.id LIMIT 1) ASC`,
    );
  });

  it("lookup field sorts via its via-link target column", () => {
    const sql = buildOrderBy([{ fieldId: "fLookup", direction: "desc" }], reg, "tbl");
    expect(sql).toBe(
      `ORDER BY (SELECT lt."co_name" FROM lj j JOIN companies lt ON lt.id = j.b_id WHERE j.a_id = tbl.id LIMIT 1) DESC`,
    );
  });

  it("mixes a stored sort and a linked sort", () => {
    const sql = buildOrderBy(
      [{ fieldId: "fNum", direction: "desc" }, { fieldId: "fLink", linkedFieldId: "fCoName", direction: "asc" }],
      reg,
      "tbl",
    );
    expect(sql).toBe(
      `ORDER BY "num" DESC, (SELECT lt."co_name" FROM lj j JOIN companies lt ON lt.id = j.b_id WHERE j.a_id = tbl.id LIMIT 1) ASC`,
    );
  });
});
