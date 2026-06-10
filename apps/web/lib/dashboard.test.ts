import { describe, expect, it } from "vitest";
import { buildDashboard, resolveDashboardConfig } from "./dashboard";
import type { Meta, RecordEnvelope, ViewMeta } from "./types";

const meta: Meta = {
  tables: [{ tableId: "tblWM", name: "WeeklyMetrics", slug: "grid_weeklymetrics", primaryFieldId: "fldName", position: 0, sourceKind: "table" }],
  fields: [
    { fieldId: "fldName", tableId: "tblWM", name: "Name", type: "text", options: null, isComputed: false, isPrimary: true, position: 0 },
    { fieldId: "fldWeek", tableId: "tblWM", name: "Week Start", type: "date", options: null, isComputed: false, isPrimary: false, position: 1 },
    { fieldId: "fldRoles", tableId: "tblWM", name: "Roles Discovered", type: "number", options: null, isComputed: false, isPrimary: false, position: 2 },
    { fieldId: "fldRate", tableId: "tblWM", name: "Reply Rate", type: "formula", options: null, isComputed: true, isPrimary: false, position: 3 },
  ],
  views: [],
};

const view = (config: ViewMeta["config"]): ViewMeta => ({ viewId: "v1", tableId: "tblWM", name: "Trends", type: "dashboard", position: 1, isHidden: false, config });
const rec = (id: string, week: string, roles: unknown, rate: unknown): RecordEnvelope => ({ id, createdTime: "t", fields: { fldWeek: week, fldRoles: roles, fldRate: rate } });

describe("resolveDashboardConfig", () => {
  it("uses explicit config when present", () => {
    expect(resolveDashboardConfig(meta, view({ dashboard: { dateFieldId: "fldWeek", metricFieldIds: ["fldRoles"] } }))).toEqual({
      dateFieldId: "fldWeek",
      metricFieldIds: ["fldRoles"],
    });
  });

  it("infers the date field + number/formula metrics when unconfigured (skips text)", () => {
    const r = resolveDashboardConfig(meta, view({}));
    expect(r.dateFieldId).toBe("fldWeek");
    expect(r.metricFieldIds).toEqual(["fldRoles", "fldRate"]);
  });
});

describe("buildDashboard", () => {
  const v = view({ dashboard: { dateFieldId: "fldWeek", metricFieldIds: ["fldRoles", "fldRate"] } });

  it("sorts points by date and computes current + week-over-week delta", () => {
    const d = buildDashboard(meta, v, [rec("b", "2026-06-08", 10, 0.2), rec("a", "2026-06-01", 4, 0.1)]);
    expect(d.points.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(d.points[1]!.fldRoles).toBe(10);
    const roles = d.metrics.find((m) => m.fieldId === "fldRoles")!;
    expect(roles).toMatchObject({ name: "Roles Discovered", current: 10, prevDelta: 6 });
  });

  it("prevDelta is null with a single row", () => {
    const roles = buildDashboard(meta, v, [rec("a", "2026-06-01", 4, 0.1)]).metrics.find((m) => m.fieldId === "fldRoles")!;
    expect(roles.current).toBe(4);
    expect(roles.prevDelta).toBeNull();
  });

  it("coerces numeric strings and skips non-numeric values", () => {
    const d = buildDashboard(meta, v, [rec("a", "2026-06-01", "4", "x"), rec("b", "2026-06-08", 10, 0.2)]);
    expect(d.points[0]!.fldRoles).toBe(4); // "4" → 4
    expect(d.points[0]!.fldRate).toBeUndefined(); // "x" dropped
    expect(d.metrics.find((m) => m.fieldId === "fldRate")!.current).toBe(0.2);
  });

  it("uses the last RECORDED value when the latest row's metric is null", () => {
    // latest row has a null Roles value; earlier two rows are 4 then 10.
    const records = [rec("a", "2026-06-01", 4, 0.1), rec("b", "2026-06-08", 10, 0.2), rec("c", "2026-06-15", null, 0.3)];
    const roles = buildDashboard(meta, v, records).metrics.find((m) => m.fieldId === "fldRoles")!;
    expect(roles.current).toBe(10); // last recorded, not null
    expect(roles.prevDelta).toBe(6); // 10 - 4
  });

  it("returns empty points / null metrics when there are no records", () => {
    const d = buildDashboard(meta, v, []);
    expect(d.points).toEqual([]);
    expect(d.metrics.every((m) => m.current === null && m.prevDelta === null)).toBe(true);
  });
});
