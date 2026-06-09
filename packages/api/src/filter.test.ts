import { describe, expect, it } from "vitest";
import { buildWhere } from "./filter.js";
import type { FieldMeta } from "./types.js";

function field(partial: Partial<FieldMeta> & { fieldId: string; type: FieldMeta["type"] }): FieldMeta {
  return {
    tableId: "t", name: partial.fieldId, columnName: partial.columnName ?? null,
    position: 0, options: partial.options ?? null, isComputed: false, isPrimary: false,
    ...partial,
  };
}

const fields = new Map<string, FieldMeta>([
  ["fNum", field({ fieldId: "fNum", type: "number", columnName: "num" })],
  ["fTxt", field({ fieldId: "fTxt", type: "text", columnName: "txt" })],
  ["fChk", field({ fieldId: "fChk", type: "checkbox", columnName: "chk" })],
  ["fDt", field({ fieldId: "fDt", type: "datetime", columnName: "dt" })],
  ["fLink", field({ fieldId: "fLink", type: "link", options: { join: "lj", self: "a_id", other: "b_id", linkedTableId: "t2" } })],
  ["fFormula", field({ fieldId: "fFormula", type: "formula", columnName: null })],
]);

const where = (conds: Array<{ fieldId: string; op: string; value?: unknown }>) =>
  buildWhere({ conjunction: "and", conditions: conds as never }, fields, "tbl");

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
});
