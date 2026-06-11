import { describe, expect, it } from "vitest";
import { buildAggregate } from "./aggregate";
import type { AggregateSpec, FieldMeta, Registry } from "./types";

function field(fieldId: string, columnName: string | null, type: FieldMeta["type"]): FieldMeta {
  return { fieldId, tableId: "tblD", name: fieldId, type, columnName, position: 0, options: null, isComputed: false, isPrimary: false };
}
const fields = [field("fAmount", "amount", "number"), field("fStage", "stage", "select"), field("fClose", "close_date", "date")];
const reg: Registry = {
  tables: [{ tableId: "tblD", workspaceId: null, name: "Deals", slug: "deals", primaryFieldId: "fStage", position: 0, sourceKind: "d1", sourceRef: null }],
  fieldsByTable: new Map([["tblD", fields]]),
  fieldById: new Map(fields.map((f) => [f.fieldId, f])),
  views: [],
  dashboards: [],
};
const agg = (spec: AggregateSpec) => buildAggregate(spec, reg, "tblD");

describe("buildAggregate", () => {
  it("count of all rows → COUNT(*), no group", () => {
    const r = agg({ agg: "count" });
    expect(r.sql).toBe("SELECT COUNT(*) AS v FROM deals");
    expect(r.binds).toEqual([]);
  });

  it("sum(amount) grouped by stage", () => {
    const r = agg({ agg: "sum", metric: "fAmount", groupBy: "fStage" });
    expect(r.sql).toBe('SELECT "stage" AS g, SUM("amount") AS v FROM deals GROUP BY "stage" ORDER BY "stage"');
  });

  it("sum(amount) bucketed by month(close_date)", () => {
    const r = agg({ agg: "sum", metric: "fAmount", groupBy: "fClose", bucket: "month" });
    expect(r.sql).toContain(`strftime('%Y-%m', "close_date")`);
    expect(r.sql).toContain("GROUP BY strftime('%Y-%m', \"close_date\")");
  });

  it("count grouped by stage uses COUNT(*)", () => {
    expect(agg({ agg: "count", groupBy: "fStage" }).sql).toContain("COUNT(*) AS v");
  });

  it("applies a bound filter (values never interpolated)", () => {
    const r = agg({ agg: "sum", metric: "fAmount", groupBy: "fStage", filter: { conjunction: "and", conditions: [{ fieldId: "fStage", op: "is", value: "Won" }] } });
    expect(r.sql).toContain("WHERE");
    expect(r.binds).toEqual(["Won"]);
  });

  it("rejects an invalid agg fn", () => {
    expect(() => agg({ agg: "median" as AggregateSpec["agg"] })).toThrow(/invalid agg/);
  });

  it("rejects sum without a numeric metric", () => {
    expect(() => agg({ agg: "sum", metric: "fStage" })).toThrow(/numeric metric/);
    expect(() => agg({ agg: "avg" })).toThrow(/numeric metric/);
  });

  it("rejects an unknown groupBy / metric field", () => {
    expect(() => agg({ agg: "count", groupBy: "fNope" })).toThrow(/groupBy/);
    expect(() => agg({ agg: "sum", metric: "fNope" })).toThrow(/numeric metric/);
  });

  it("rejects an invalid bucket", () => {
    expect(() => agg({ agg: "count", groupBy: "fClose", bucket: "decade" as AggregateSpec["bucket"] })).toThrow(/bucket/);
  });
});
